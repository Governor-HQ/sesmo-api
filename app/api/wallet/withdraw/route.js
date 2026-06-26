// POST /api/wallet/withdraw  { amount, bank_name, account_number, account_name, idempotency_key? }
// Holds the funds immediately (atomic 'withdrawal' debit) and queues a request.
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getUserFromRequest } from "@/lib/auth";
import { ensureWallet } from "@/lib/wallet";
import pool from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ success: false, error: "Please log in." }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const naira = Number(body.amount);
    if (!Number.isFinite(naira) || naira < 100 || naira > 1000000)
      return NextResponse.json({ success: false, error: "Amount must be between 100 and 1,000,000 NGN." }, { status: 400 });

    const bankName = String(body.bank_name || "").trim();
    const accountName = String(body.account_name || "").trim();
    const accountNumber = String(body.account_number || "").replace(/\s/g, "");
    if (!bankName || !accountName) return NextResponse.json({ success: false, error: "Enter the bank and account name." }, { status: 400 });
    if (!/^[0-9]{10}$/.test(accountNumber)) return NextResponse.json({ success: false, error: "Account number must be 10 digits." }, { status: 400 });

    const amountKobo = Math.round(naira * 100);
    const wallet = await ensureWallet(user.userId);
    const key = body.idempotency_key ? String(body.idempotency_key).slice(0, 80) : crypto.randomUUID();
    const reference = `SES-WDL-${key}`;

    const { rows } = await pool.query(
      `select request_withdrawal($1::uuid,$2::uuid,$3::bigint,$4::text,$5::text,$6::text,$7::text) as id`,
      [user.userId, wallet.id, amountKobo, bankName, accountNumber, accountName, reference]
    );
    const { rows: wr } = await pool.query(
      "select id, amount, bank_name, account_number, status, created_at from withdrawals where id = $1",
      [rows[0].id]
    );
    const w = wr[0];
    return NextResponse.json({
      success: true,
      withdrawal: { id: w.id, amount_kobo: Number(w.amount), amount_naira: Number(w.amount) / 100, bank_name: w.bank_name, status: w.status, created_at: w.created_at },
    });
  } catch (e) {
    if (String(e.message || "").includes("INSUFFICIENT_FUNDS"))
      return NextResponse.json({ success: false, error: "Not enough balance for that withdrawal." }, { status: 400 });
    console.error("withdraw error:", e);
    return NextResponse.json({ success: false, error: "Could not request withdrawal." }, { status: 500 });
  }
}
