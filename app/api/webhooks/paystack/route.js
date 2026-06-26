// POST /api/webhooks/paystack — the ONLY thing that credits a wallet.
// App Router gives us the raw body directly via request.text().
import { NextResponse } from "next/server";
import pool, { withTransaction } from "@/lib/db";
import { verifySignature } from "@/lib/paystack";

export const runtime = "nodejs";

export async function POST(request) {
  const raw = await request.text(); // raw body, required for signature check

  // Authenticate. Anything failing signature never touches a wallet.
  if (!verifySignature(raw, request.headers.get("x-paystack-signature"))) {
    return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 401 });
  }

  let event;
  try { event = JSON.parse(raw); }
  catch (_) { return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 }); }

  // Acknowledge non-success events so Paystack stops retrying.
  if (event?.event !== "charge.success") return NextResponse.json({ success: true, received: true });

  const reference = event?.data?.reference;
  const confirmedKobo = event?.data?.amount; // Paystack sends kobo
  if (!reference || !Number.isInteger(confirmedKobo)) return NextResponse.json({ success: true, received: true });

  try {
    await withTransaction(async (client) => {
      // Lock our payment row. Concurrent duplicate webhooks serialize here.
      const { rows } = await client.query(
        `select id, wallet_id, status from payments where paystack_reference = $1 for update`,
        [reference]
      );
      const payment = rows[0];
      if (!payment) return;                      // reference we never created -> ignore
      if (payment.status === "success") return;  // already processed

      // Credit the CONFIRMED amount; idempotent on the reference inside wallet_credit.
      const { rows: cr } = await client.query(
        `select wallet_credit($1::uuid, $2::bigint, 'fund', $3::text, $4::jsonb) as entry_id`,
        [payment.wallet_id, confirmedKobo, reference, JSON.stringify({ source: "paystack", payment_id: payment.id })]
      );
      await client.query(
        `update payments set status = 'success', ledger_entry_id = $2, raw = $3::jsonb where id = $1`,
        [payment.id, cr[0].entry_id, JSON.stringify(event)]
      );
    });
    return NextResponse.json({ success: true, received: true });
  } catch (e) {
    console.error("paystack webhook error:", e);
    // 500 -> Paystack retries; our credit is idempotent so retries are safe.
    return NextResponse.json({ success: false, error: "Processing error" }, { status: 500 });
  }
}
