// GET /api/wallet/fund/verify?reference=SES-FUND-...
// Confirms a payment with Paystack and credits the wallet immediately on return.
// Idempotent on the reference, so the webhook firing too can't double-credit.
import { NextResponse } from "next/server";
import pool, { withTransaction } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { verifyTransaction } from "@/lib/paystack";

export const runtime = "nodejs";

async function balanceOf(walletId) {
  const { rows } = await pool.query("select balance from wallets where id = $1", [walletId]);
  return rows[0] ? Number(rows[0].balance) : 0;
}

export async function GET(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ success: false, error: "Please log in." }, { status: 401 });
  try {
    const url = new URL(request.url);
    const reference = url.searchParams.get("reference") || url.searchParams.get("trxref");
    if (!reference) return NextResponse.json({ success: false, error: "Missing reference." }, { status: 400 });

    // The payment must be one we created, owned by this user.
    const { rows } = await pool.query(
      "select id, wallet_id, user_id, status from payments where paystack_reference = $1", [reference]
    );
    const payment = rows[0];
    if (!payment || payment.user_id !== user.userId)
      return NextResponse.json({ success: false, error: "Unknown payment." }, { status: 404 });

    if (payment.status === "success")
      return NextResponse.json({ success: true, credited: false, already: true, balance_kobo: await balanceOf(payment.wallet_id) });

    // Ask Paystack directly.
    const tx = await verifyTransaction(reference);
    if (!tx || tx.status !== "success")
      return NextResponse.json({ success: false, pending: true, error: "Payment not confirmed yet." });

    const confirmedKobo = tx.amount;
    await withTransaction(async (client) => {
      const { rows: pr } = await client.query(
        "select id, wallet_id, status from payments where paystack_reference = $1 for update", [reference]
      );
      const p = pr[0];
      if (!p || p.status === "success") return; // someone (webhook) beat us — fine
      const { rows: cr } = await client.query(
        "select wallet_credit($1::uuid, $2::bigint, 'fund', $3::text, $4::jsonb) as entry_id",
        [p.wallet_id, confirmedKobo, reference, JSON.stringify({ source: "paystack-verify", payment_id: p.id })]
      );
      await client.query(
        "update payments set status = 'success', ledger_entry_id = $2, raw = $3::jsonb where id = $1",
        [p.id, cr[0].entry_id, JSON.stringify(tx)]
      );
    });

    return NextResponse.json({ success: true, credited: true, amount_kobo: confirmedKobo, balance_kobo: await balanceOf(payment.wallet_id) });
  } catch (e) {
    console.error("verify error:", e);
    return NextResponse.json({ success: false, error: "Could not verify payment." }, { status: 500 });
  }
}
