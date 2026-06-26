-- ============================================================
-- SESMO TELECOM — SERVICES (Slice 2)
-- Builds on 001. Run AFTER 001_wallet_ledger.sql.
-- Adds: a product catalogue, an idempotency reference on orders,
-- and an atomic service_purchase() that deducts + queues in one tx.
-- ============================================================

-- ---------- product catalogue (admin-editable later) ----------
create table service_products (
  id          uuid primary key default gen_random_uuid(),
  category    text not null check (category in ('tv','exam_pin','other')),
  provider    text not null,                      -- GOtv | DStv | Startimes | WAEC | ...
  name        text not null,                      -- package / item name
  code        text,                               -- provider code (for future automation)
  price       bigint not null check (price > 0),  -- KOBO
  requires_smartcard boolean not null default false,
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_service_products_updated
  before update on service_products for each row execute function set_updated_at();
create index idx_products_browse on service_products (category, provider, active, sort);
alter table service_products enable row level security;

-- ---------- idempotency key on orders ----------
alter table service_orders add column if not exists reference text;
create unique index if not exists uq_service_orders_reference
  on service_orders (reference) where reference is not null;

-- ============================================================
-- service_purchase() — ATOMIC purchase.
-- Deducts the wallet (via the proven wallet_debit) AND creates the
-- pending order in ONE transaction. If the debit fails (insufficient
-- funds), nothing is created. Idempotent on p_reference.
-- Returns the service_orders.id.
-- ============================================================
create or replace function service_purchase(
  p_user_id    uuid,
  p_wallet_id  uuid,
  p_product_id uuid,
  p_quantity   int,
  p_details    jsonb,
  p_reference  text
) returns uuid as $$
declare
  v_prod      service_products%rowtype;
  v_amount    bigint;
  v_entry_id  uuid;
  v_order_id  uuid;
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception 'INVALID_QUANTITY';
  end if;

  -- idempotency: same reference -> return the existing order, no re-charge
  select id into v_order_id from service_orders where reference = p_reference;
  if v_order_id is not null then
    return v_order_id;
  end if;

  select * into v_prod from service_products where id = p_product_id and active = true;
  if not found then
    raise exception 'PRODUCT_UNAVAILABLE';
  end if;

  v_amount := v_prod.price * p_quantity;

  -- atomic deduction (raises INSUFFICIENT_FUNDS -> rolls back everything)
  v_entry_id := wallet_debit(p_wallet_id, v_amount, 'purchase', p_reference, coalesce(p_details,'{}'::jsonb));

  insert into service_orders
    (user_id, wallet_id, ledger_entry_id, category, provider, amount, details, status, reference)
  values
    (p_user_id, p_wallet_id, v_entry_id, v_prod.category, v_prod.provider, v_amount,
     coalesce(p_details,'{}'::jsonb)
       || jsonb_build_object('product_id', p_product_id, 'product_name', v_prod.name, 'quantity', p_quantity),
     'pending', p_reference)
  returning id into v_order_id;

  return v_order_id;

exception
  when unique_violation then
    select id into v_order_id from service_orders where reference = p_reference;
    return v_order_id;
end;
$$ language plpgsql;

-- ============================================================
-- SEED — launch catalogue (prices in kobo; admin can edit later).
-- ============================================================
insert into service_products (category, provider, name, price, requires_smartcard, sort) values
  ('tv','GOtv','GOtv Smallie',    190000, true, 10),
  ('tv','GOtv','GOtv Jinja',      390000, true, 11),
  ('tv','GOtv','GOtv Jolli',      580000, true, 12),
  ('tv','GOtv','GOtv Max',        850000, true, 13),
  ('tv','DStv','DStv Padi',       440000, true, 20),
  ('tv','DStv','DStv Yanga',      600000, true, 21),
  ('tv','DStv','DStv Confam',    1100000, true, 22),
  ('tv','DStv','DStv Compact',   1900000, true, 23),
  ('tv','Startimes','Startimes Nova',  190000, true, 30),
  ('tv','Startimes','Startimes Basic', 400000, true, 31),
  ('exam_pin','WAEC','WAEC Result Checker PIN', 350000, false, 40),
  ('exam_pin','NECO','NECO Result Token',       130000, false, 41),
  ('exam_pin','NABTEB','NABTEB Scratch Card',   100000, false, 42);
