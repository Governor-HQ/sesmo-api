-- ============================================================
-- SESMO TELECOM — PASSWORD RESET (Wave 1)
-- One-time, hashed, expiring reset tokens. The raw token only ever lives in the
-- email link; we store its SHA-256 hash, exactly like a password.
-- ============================================================
create table if not exists password_reset_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id),
  token_hash  text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_prt_hash on password_reset_tokens(token_hash);
create index if not exists idx_prt_user on password_reset_tokens(user_id, created_at desc);
