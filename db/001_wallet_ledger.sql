-- ============================================================
-- ACHO COMMUNICATIONS — WALLET + LEDGER FOUNDATION
-- Stage 01.  Deploy FIRST, before any API code.
-- Deploy: paste the FULL CONTENTS of this file into the
--         Supabase SQL editor and run it.
--
-- MONEY IS STORED IN KOBO (bigint integer). 100 kobo = 1 NGN.
--   * No floats, ever — float rounding silently loses/creates money.
--   * Paystack amounts are already in kobo, so funding maps 1:1.
--
-- INVARIANTS THIS SCHEMA GUARANTEES:
--   1. A wallet balance can NEVER go negative (CHECK + atomic op).
--   2. Every money movement writes ONE immutable ledger row in the
--      SAME transaction as the balance change (commit or fail together).
--   3. Ledger rows can never be UPDATEd or DELETEd (trigger-enforced).
--   4. A given reference credits/debits a wallet at most once
--      (idempotency — safe against Paystack webhook retries).
-- ============================================================

create extension if not exists pgcrypto;  -- for gen_random_uuid()

-- ---------- updated_at helper ----------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- USERS  (stub now; real register/login/JWT layers on top later)
-- The wallet/ledger needs a user_id to attribute money to, so the
-- table + FKs exist from line one. Auth columns are nullable for now
-- and get filled in when accounts are built — no future migration.
-- ============================================================
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  phone         text unique,
  password_hash text,                       -- populated when auth is built
  full_name     text,
  role          text not null default 'customer'
                  check (role in ('customer','admin')),
  status        text not null default 'active'
                  check (status in ('active','suspended')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_users_updated
  before update on users for each row execute function set_updated_at();

-- ============================================================
-- WALLETS  (authoritative current balance; exactly one per user)
-- balance is the locked source of truth; ledger_entries is history.
-- ============================================================
create table wallets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references users(id) on delete restrict,
  balance    bigint not null default 0 check (balance >= 0),  -- KOBO
  currency   text not null default 'NGN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_wallets_updated
  before update on wallets for each row execute function set_updated_at();

-- ============================================================
-- LEDGER ENTRIES  (immutable, append-only history)
-- One row per money movement. balance_after snapshots the wallet
-- balance immediately AFTER this entry, so the running balance can
-- be audited row by row.
--
-- type   : fund | purchase | transfer_in | transfer_out
--          | withdrawal | admin_credit | refund
-- amount : positive magnitude in kobo (direction implied by type)
-- NOTE   : entries are born 'completed' because a row is only written
--          when money has actually moved. Reversals are done by writing
--          a compensating 'refund' entry — never by mutating a row.
-- ============================================================
create table ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  wallet_id       uuid not null references wallets(id) on delete restrict,
  type            text not null check (type in (
                    'fund','purchase','transfer_in','transfer_out',
                    'withdrawal','admin_credit','refund')),
  amount          bigint not null check (amount > 0),          -- KOBO
  balance_after   bigint not null check (balance_after >= 0),  -- KOBO snapshot
  reference       text,                  -- idempotency / external ref
  status          text not null default 'completed'
                    check (status in ('completed','reversed')),
  counterparty_wallet_id uuid references wallets(id),  -- the other side of a transfer
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- one reference can only ever produce one entry -> idempotency backstop
create unique index uq_ledger_reference
  on ledger_entries (reference) where reference is not null;
create index idx_ledger_wallet_time
  on ledger_entries (wallet_id, created_at desc);

-- ledger rows are append-only: block UPDATE and DELETE outright.
create or replace function prevent_ledger_mutation() returns trigger as $$
begin
  raise exception 'ledger_entries is append-only; % is not allowed', tg_op;
end;
$$ language plpgsql;
create trigger trg_ledger_immutable
  before update or delete on ledger_entries
  for each row execute function prevent_ledger_mutation();

-- ============================================================
-- ATOMIC MONEY OPERATIONS
-- The ONLY sanctioned way a balance changes. Each does the balance
-- change AND the ledger write inside one function call (= one
-- transaction). If anything raises, the whole thing rolls back, so
-- money can never half-move.
-- ============================================================

-- DEBIT: deduct from a wallet iff funds are sufficient. Returns entry id.
-- Used by: purchase, transfer_out, withdrawal.
create or replace function wallet_debit(
  p_wallet_id  uuid,
  p_amount     bigint,
  p_type       text,
  p_reference  text  default null,
  p_metadata   jsonb default '{}'::jsonb,
  p_counterparty_wallet_id uuid default null
) returns uuid as $$
declare
  v_new_balance bigint;
  v_entry_id    uuid;
  v_existing    uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  -- fast-path idempotency: if this reference already moved money, return it.
  if p_reference is not null then
    select id into v_existing from ledger_entries where reference = p_reference;
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  -- Atomic, race-safe deduction. The UPDATE locks the wallet row, so
  -- concurrent debits serialize; the WHERE guard makes an overdraft
  -- (the classic double-spend) impossible.
  update wallets
     set balance = balance - p_amount
   where id = p_wallet_id
     and balance >= p_amount
  returning balance into v_new_balance;

  if not found then
    if not exists (select 1 from wallets where id = p_wallet_id) then
      raise exception 'WALLET_NOT_FOUND';
    end if;
    raise exception 'INSUFFICIENT_FUNDS';
  end if;

  insert into ledger_entries
    (wallet_id, type, amount, balance_after, reference, counterparty_wallet_id, metadata)
  values
    (p_wallet_id, p_type, p_amount, v_new_balance, p_reference,
     p_counterparty_wallet_id, coalesce(p_metadata,'{}'::jsonb))
  returning id into v_entry_id;

  return v_entry_id;

exception
  when unique_violation then
    -- a concurrent call with the same reference won the race; reuse it.
    select id into v_existing from ledger_entries where reference = p_reference;
    return v_existing;
end;
$$ language plpgsql;

-- CREDIT: add to a wallet. Returns entry id.
-- Used by: fund (Paystack webhook), refund, admin_credit, transfer_in.
create or replace function wallet_credit(
  p_wallet_id  uuid,
  p_amount     bigint,
  p_type       text,
  p_reference  text  default null,
  p_metadata   jsonb default '{}'::jsonb,
  p_counterparty_wallet_id uuid default null
) returns uuid as $$
declare
  v_new_balance bigint;
  v_entry_id    uuid;
  v_existing    uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  -- fast-path idempotency: CRITICAL for Paystack webhook retries.
  if p_reference is not null then
    select id into v_existing from ledger_entries where reference = p_reference;
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  update wallets
     set balance = balance + p_amount
   where id = p_wallet_id
  returning balance into v_new_balance;

  if not found then
    raise exception 'WALLET_NOT_FOUND';
  end if;

  insert into ledger_entries
    (wallet_id, type, amount, balance_after, reference, counterparty_wallet_id, metadata)
  values
    (p_wallet_id, p_type, p_amount, v_new_balance, p_reference,
     p_counterparty_wallet_id, coalesce(p_metadata,'{}'::jsonb))
  returning id into v_entry_id;

  return v_entry_id;

exception
  when unique_violation then
    -- duplicate webhook delivery raced us; the money is already credited.
    select id into v_existing from ledger_entries where reference = p_reference;
    return v_existing;
end;
$$ language plpgsql;

-- ============================================================
-- PAYMENTS  (Paystack funding records / webhook idempotency aid)
-- One row per Paystack reference. The wallet is credited ONLY from a
-- verified webhook server-side — NEVER from the browser.
-- ============================================================
create table payments (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete restrict,
  wallet_id          uuid not null references wallets(id) on delete restrict,
  paystack_reference text not null unique,
  amount             bigint not null check (amount > 0),  -- KOBO
  status             text not null default 'pending'
                       check (status in ('pending','success','failed')),
  ledger_entry_id    uuid references ledger_entries(id),
  raw                jsonb not null default '{}'::jsonb,   -- raw webhook payload
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_payments_updated
  before update on payments for each row execute function set_updated_at();

-- ============================================================
-- SERVICE ORDERS  (admin fulfillment queue)
-- Money is deducted atomically at order time (a 'purchase' ledger
-- entry). THIS row tracks manual fulfillment:
--   pending -> completed,  or  rejected -> refunded (a 'refund' entry
--   returns the funds).
-- ============================================================
create table service_orders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete restrict,
  wallet_id       uuid not null references wallets(id) on delete restrict,
  ledger_entry_id uuid not null references ledger_entries(id),  -- the debit
  category        text not null check (category in ('tv','exam_pin','other')),
  provider        text,        -- GOtv|DStv|Startimes|FreeTV|WAEC|NECO|NABTEB|...
  amount          bigint not null check (amount > 0),  -- KOBO
  details         jsonb not null default '{}'::jsonb,  -- smartcard no, package, etc.
  status          text not null default 'pending'
                    check (status in ('pending','completed','rejected','refunded')),
  result          jsonb,       -- PIN / confirmation delivered to the customer
  refund_ledger_entry_id uuid references ledger_entries(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  fulfilled_at    timestamptz,
  fulfilled_by    uuid references users(id)
);
create trigger trg_service_orders_updated
  before update on service_orders for each row execute function set_updated_at();
create index idx_service_orders_status on service_orders (status, created_at);
create index idx_service_orders_user   on service_orders (user_id, created_at desc);

-- ============================================================
-- WITHDRAWALS  (customer cash-out; admin approves & pays manually)
-- Funds are HELD immediately (a 'withdrawal' debit at request time).
--   approve -> mark 'paid'.   reject -> 'refund' entry returns funds.
-- ============================================================
create table withdrawals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete restrict,
  wallet_id       uuid not null references wallets(id) on delete restrict,
  ledger_entry_id uuid not null references ledger_entries(id),  -- the hold/debit
  amount          bigint not null check (amount > 0),  -- KOBO
  bank_name       text not null,
  account_number  text not null,
  account_name    text not null,
  status          text not null default 'pending'
                    check (status in ('pending','paid','rejected')),
  refund_ledger_entry_id uuid references ledger_entries(id),
  admin_note      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  processed_at    timestamptz,
  processed_by    uuid references users(id)
);
create trigger trg_withdrawals_updated
  before update on withdrawals for each row execute function set_updated_at();
create index idx_withdrawals_status on withdrawals (status, created_at);
create index idx_withdrawals_user   on withdrawals (user_id, created_at desc);

-- ============================================================
-- ROW LEVEL SECURITY (defense in depth)
-- The Next.js API connects via the session pooler as the table owner
-- and BYPASSES RLS; real ownership checks live in the API layer
-- (JWT -> user_id -> filter). Enabling RLS with no public policies
-- means that even if a Supabase anon/public key ever leaked, these
-- tables stay unreadable. Lock the doors anyway.
-- ============================================================
alter table users          enable row level security;
alter table wallets        enable row level security;
alter table ledger_entries enable row level security;
alter table payments       enable row level security;
alter table service_orders enable row level security;
alter table withdrawals    enable row level security;

-- ============================================================
-- OPTIONAL SMOKE TEST — run separately to verify, then delete the rows.
-- Proves: credit, debit, overdraft block, idempotency, immutability.
-- ------------------------------------------------------------
-- with u as (insert into users (email) values ('test@acho.local') returning id)
-- insert into wallets (user_id) select id from u;
--
-- -- fund 5,000 NGN (500000 kobo), idempotent on reference 'PSK_TEST_1':
-- select wallet_credit(
--   (select w.id from wallets w join users us on us.id=w.user_id
--     where us.email='test@acho.local'),
--   500000, 'fund', 'PSK_TEST_1');
-- -- run the SAME line again -> balance must NOT change (idempotent).
--
-- -- buy a 250 NGN service (25000 kobo):
-- select wallet_debit(
--   (select w.id from wallets w join users us on us.id=w.user_id
--     where us.email='test@acho.local'),
--   25000, 'purchase', 'ORDER_TEST_1');
--
-- -- overspend attempt -> must RAISE 'INSUFFICIENT_FUNDS':
-- -- select wallet_debit((select w.id from wallets w join users us
-- --   on us.id=w.user_id where us.email='test@acho.local'),
-- --   99999999, 'purchase', 'ORDER_TEST_2');
--
-- -- inspect balance + history:
-- -- select balance from wallets w join users us on us.id=w.user_id
-- --   where us.email='test@acho.local';
-- -- select type, amount, balance_after, reference, created_at
-- --   from ledger_entries order by created_at;
--
-- -- immutability check -> must RAISE (trigger blocks it):
-- -- update ledger_entries set amount = 1;
-- ============================================================
