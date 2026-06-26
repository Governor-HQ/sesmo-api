-- ============================================================
-- SESMO TELECOM — ACCOUNTS (Slice 5)
-- Builds on 001-004. The users table already exists (from 001);
-- this adds atomic registration: create the user AND their wallet
-- in one transaction, with normalised (lower/trim) email.
-- ============================================================

create or replace function register_user(
  p_email         text,
  p_password_hash text,
  p_full_name     text,
  p_phone         text
) returns uuid as $$
declare v_user_id uuid;
begin
  insert into users (email, password_hash, full_name, phone)
    values (lower(trim(p_email)), p_password_hash, nullif(trim(p_full_name),''), nullif(trim(p_phone),''))
    returning id into v_user_id;

  insert into wallets (user_id) values (v_user_id);   -- wallet born with the account
  return v_user_id;

exception when unique_violation then
  raise exception 'ACCOUNT_EXISTS';   -- email or phone already registered
end;
$$ language plpgsql;
