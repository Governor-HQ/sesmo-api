-- ============================================================
-- SESMO TELECOM — VTU ORDERS (Slice 7): API-fulfilled airtime & data via SABVTU
-- Async delivery: buy -> 'processing' -> webhook -> 'completed' or refunded.
-- Mirrors the wallet/ledger rules: atomic, idempotent on reference, kobo bigint.
-- ============================================================

create table if not exists vtu_orders (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id),
  wallet_id         uuid not null references wallets(id),
  category          text not null check (category in ('airtime','data')),
  network           text,
  plan_id           text not null,
  plan_name         text,
  recipient_phone   text not null,
  amount_kobo       bigint not null check (amount_kobo > 0),  -- what the customer paid
  cost_kobo         bigint,                                   -- what SABVTU charged us (optional)
  reference         text not null unique,                     -- our idempotency key
  provider_reference text,                                    -- SABVTU's own ref (from buy response)
  status            text not null default 'processing'
                      check (status in ('processing','completed','failed','refunded')),
  provider_status   text,
  provider_response text,
  ledger_debit_id   uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_vtu_user on vtu_orders(user_id, created_at desc);
create index if not exists idx_vtu_provref on vtu_orders(provider_reference);

-- Atomic: debit the wallet and open a 'processing' order. Idempotent on reference.
create or replace function vtu_purchase(
  p_user uuid, p_amount_kobo bigint, p_category text, p_network text,
  p_plan_id text, p_plan_name text, p_phone text, p_reference text
) returns uuid as $$
declare v_wallet uuid; v_entry uuid; v_order uuid;
begin
  select id into v_order from vtu_orders where reference = p_reference;
  if v_order is not null then return v_order; end if;     -- idempotent replay

  select id into v_wallet from wallets where user_id = p_user;
  if v_wallet is null then raise exception 'WALLET_NOT_FOUND'; end if;

  -- raises INSUFFICIENT_FUNDS -> whole thing rolls back
  v_entry := wallet_debit(v_wallet, p_amount_kobo, 'purchase', p_reference,
    jsonb_build_object('kind','vtu','category',p_category,'plan_id',p_plan_id,'phone',p_phone));

  insert into vtu_orders
    (user_id, wallet_id, category, network, plan_id, plan_name, recipient_phone, amount_kobo, reference, status, ledger_debit_id)
  values
    (p_user, v_wallet, p_category, p_network, p_plan_id, p_plan_name, p_phone, p_amount_kobo, p_reference, 'processing', v_entry)
  returning id into v_order;
  return v_order;
end;
$$ language plpgsql;

-- Mark delivered (only from 'processing').
create or replace function vtu_complete(p_reference text, p_provider_status text, p_response text)
returns boolean as $$
declare v_n int;
begin
  update vtu_orders
     set status='completed', provider_status=p_provider_status, provider_response=p_response, updated_at=now()
   where reference = p_reference and status='processing';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$ language plpgsql;

-- Refund the customer (idempotent). Never refunds a completed order.
create or replace function vtu_refund(p_reference text, p_provider_status text, p_response text)
returns boolean as $$
declare v vtu_orders%rowtype;
begin
  select * into v from vtu_orders where reference = p_reference for update;
  if not found then return false; end if;
  if v.status in ('refunded','completed') then return false; end if;

  perform wallet_credit(v.wallet_id, v.amount_kobo, 'refund', 'SES-VRF-' || v.reference,
    jsonb_build_object('kind','vtu_refund','vtu_order', v.id));
  update vtu_orders
     set status='refunded', provider_status=p_provider_status, provider_response=p_response, updated_at=now()
   where id = v.id;
  return true;
end;
$$ language plpgsql;
