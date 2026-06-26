-- ============================================================
-- SESMO TELECOM — ADMIN FULFILMENT (Slice 3)
-- Builds on 001 + 002. Run AFTER them.
-- Adds: an admin note on orders, and two atomic state transitions —
-- fulfil (deliver the PIN/confirmation) and reject (refund the wallet).
-- ============================================================

alter table service_orders add column if not exists admin_note text;

-- ---------- fulfil: pending -> completed, attach the result ----------
-- Guarded on status='pending' so two admins can't double-fulfil.
create or replace function fulfill_service_order(
  p_order_id uuid,
  p_admin_id uuid,
  p_result   jsonb
) returns void as $$
declare v_rows int;
begin
  update service_orders
     set status = 'completed', result = p_result,
         fulfilled_by = p_admin_id, fulfilled_at = now()
   where id = p_order_id and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'ORDER_NOT_PENDING';   -- missing, or already handled
  end if;
end;
$$ language plpgsql;

-- ---------- reject: pending -> refunded, return the money ----------
-- Atomic: credits the wallet back (a 'refund' ledger entry) AND flips the
-- order, in one transaction. Idempotent via the unique refund reference.
create or replace function refund_service_order(
  p_order_id uuid,
  p_admin_id uuid,
  p_note     text
) returns uuid as $$
declare
  v_order service_orders%rowtype;
  v_entry uuid;
begin
  select * into v_order from service_orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'pending' then raise exception 'ORDER_NOT_PENDING'; end if;

  -- return the funds (one refund per order -> idempotent reference)
  v_entry := wallet_credit(
    v_order.wallet_id, v_order.amount, 'refund',
    'SES-RFND-' || v_order.id::text,
    jsonb_build_object('reason','admin_reject','order_id', v_order.id)
  );

  update service_orders
     set status = 'refunded', refund_ledger_entry_id = v_entry, admin_note = p_note,
         fulfilled_by = p_admin_id, fulfilled_at = now()
   where id = p_order_id;

  return v_entry;
end;
$$ language plpgsql;
