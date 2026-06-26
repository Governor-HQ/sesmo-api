-- ============================================================
-- SESMO TELECOM — WITHDRAWALS (Slice 4)
-- Builds on 001-003. Run AFTER them.
-- Flow: request HOLDS the funds immediately (a 'withdrawal' debit) and
-- queues a pending row. Admin approves -> 'paid', or rejects -> 'rejected'
-- and the held funds are refunded. All transitions atomic.
-- ============================================================

alter table withdrawals add column if not exists reference text;
create unique index if not exists uq_withdrawals_reference
  on withdrawals (reference) where reference is not null;

-- ---------- request: atomic hold (debit) + pending row ----------
create or replace function request_withdrawal(
  p_user_id uuid, p_wallet_id uuid, p_amount bigint,
  p_bank_name text, p_account_number text, p_account_name text,
  p_reference text
) returns uuid as $$
declare v_entry uuid; v_wd uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  -- idempotency: same reference -> return the existing request, no second hold
  select id into v_wd from withdrawals where reference = p_reference;
  if v_wd is not null then return v_wd; end if;

  -- hold the funds NOW (raises INSUFFICIENT_FUNDS if short -> nothing created)
  v_entry := wallet_debit(p_wallet_id, p_amount, 'withdrawal', p_reference,
              jsonb_build_object('bank', p_bank_name, 'account', p_account_number));

  insert into withdrawals
    (user_id, wallet_id, ledger_entry_id, amount, bank_name, account_number, account_name, status, reference)
  values
    (p_user_id, p_wallet_id, v_entry, p_amount, p_bank_name, p_account_number, p_account_name, 'pending', p_reference)
  returning id into v_wd;
  return v_wd;

exception when unique_violation then
  select id into v_wd from withdrawals where reference = p_reference;
  return v_wd;
end;
$$ language plpgsql;

-- ---------- approve: pending -> paid (no money moves; it already left) ----------
create or replace function approve_withdrawal(p_id uuid, p_admin_id uuid, p_note text)
returns void as $$
declare v_rows int;
begin
  update withdrawals
     set status='paid', processed_by=p_admin_id, processed_at=now(), admin_note=p_note
   where id=p_id and status='pending';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'WITHDRAWAL_NOT_PENDING'; end if;
end;
$$ language plpgsql;

-- ---------- reject: pending -> rejected + refund the held funds ----------
create or replace function reject_withdrawal(p_id uuid, p_admin_id uuid, p_note text)
returns uuid as $$
declare v_wd withdrawals%rowtype; v_entry uuid;
begin
  select * into v_wd from withdrawals where id=p_id for update;
  if not found then raise exception 'WITHDRAWAL_NOT_FOUND'; end if;
  if v_wd.status <> 'pending' then raise exception 'WITHDRAWAL_NOT_PENDING'; end if;

  v_entry := wallet_credit(v_wd.wallet_id, v_wd.amount, 'refund',
              'SES-WRF-' || v_wd.id::text,
              jsonb_build_object('reason','withdrawal_rejected','withdrawal_id', v_wd.id));

  update withdrawals
     set status='rejected', refund_ledger_entry_id=v_entry,
         processed_by=p_admin_id, processed_at=now(), admin_note=p_note
   where id=p_id;
  return v_entry;
end;
$$ language plpgsql;
