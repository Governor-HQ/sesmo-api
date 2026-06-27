-- ============================================================
-- SESMO TELECOM — ADMIN PORTAL + RBAC (Slice 6)
-- Builds on 001-005. Adds a super_admin role, per-admin permissions,
-- a forced-password-change flag, and atomic staff creation.
--   roles:        customer | admin | super_admin
--   permissions:  orders | withdrawals | products | staff   (super_admin = all)
-- ============================================================

-- widen the role check to include super_admin
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check
  check (role in ('customer','admin','super_admin'));

-- per-admin scoped permissions + first-login password change
alter table users add column if not exists permissions text[] not null default '{}';
alter table users add column if not exists must_change_password boolean not null default false;

-- super_admin creates a staff (admin) account: no wallet, scoped permissions,
-- forced to change the temp password on first login.
create or replace function create_staff(
  p_email text, p_password_hash text, p_full_name text, p_permissions text[]
) returns uuid as $$
declare v_id uuid;
begin
  insert into users (email, password_hash, full_name, role, permissions, must_change_password)
    values (lower(trim(p_email)), p_password_hash, nullif(trim(p_full_name),''),
            'admin', coalesce(p_permissions, '{}'), true)
    returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'ACCOUNT_EXISTS';
end;
$$ language plpgsql;
