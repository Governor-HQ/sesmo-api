// lib/db.js — single pg Pool (Supabase SESSION pooler, port 5432 — NOT 6543,
// which is IPv6-only and breaks on Vercel). Reused across invocations.
import pg from "pg";
const { Pool } = pg;

if (!globalThis.__sesmoPool) {
  globalThis.__sesmoPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  });
}
const pool = globalThis.__sesmoPool;

// Run a function inside one DB transaction on a dedicated client.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
