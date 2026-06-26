// lib/wallet.js — wallet resolution helpers.
import pool from "@/lib/db";

export async function getWalletByUserId(userId) {
  const { rows } = await pool.query(
    "select id, balance, currency from wallets where user_id = $1",
    [userId]
  );
  return rows[0] || null;
}

// Lazily create a wallet if one doesn't exist yet. Once register/login ships,
// the wallet is created at signup and this just returns the existing row.
export async function ensureWallet(userId) {
  const { rows } = await pool.query(
    `insert into wallets (user_id) values ($1)
       on conflict (user_id) do update set user_id = excluded.user_id
     returning id, balance, currency`,
    [userId]
  );
  return rows[0];
}
