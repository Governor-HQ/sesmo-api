// POST /api/wallet/fund/initialize  { amount: <naira> }
// Starts a Paystack payment. Does NOT credit — only the webhook (with
// Paystack's confirmed amount) credits the wallet.
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import pool from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { ensureWallet } from "@/lib/wallet";
import { initializeTransaction } from "@/lib/paystack";

export const runtime = "nodejs";

export async function POST(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ success: false, error: "Please log in." }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const naira = Number(body.amount);
    if (!Number.isFinite(naira) || naira < 100 || naira > 1000000) {
      return NextResponse.json({ success: false, error: "Amount must be between 100 and 1,000,000 NGN." }, { status: 400 });
    }
    const amountKobo = Math.round(naira * 100);

    const { rows: userRows } = await pool.query("select email from users where id = $1", [user.userId]);
    const u = userRows[0];
    if (!u) return NextResponse.json({ success: false, error: "User not found." }, { status: 404 });
    if (!u.email) return NextResponse.json({ success: false, error: "Add an email to your profile first." }, { status: 400 });

    const wallet = await ensureWallet(user.userId);
    const reference = `SES-FUND-${crypto.randomUUID()}`;

    await pool.query(
      `insert into payments (user_id, wallet_id, paystack_reference, amount, status)
       values ($1, $2, $3, $4, 'pending')`,
      [user.userId, wallet.id, reference, amountKobo]
    );

    const data = await initializeTransaction({
      email: u.email, amountKobo, reference,
      metadata: { user_id: user.userId, wallet_id: wallet.id },
      callbackUrl: process.env.PAYSTACK_CALLBACK_URL || undefined,
    });

    return NextResponse.json({ success: true, authorization_url: data.authorization_url, reference: data.reference });
  } catch (e) {
    console.error("fund/initialize error:", e);
    return NextResponse.json({ success: false, error: "Could not start payment." }, { status: 500 });
  }
}
