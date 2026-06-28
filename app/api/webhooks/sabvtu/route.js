// POST /api/webhooks/sabvtu — SABVTU delivery-status callbacks.
// Final status lands here after a buy: 200 success, 800 failed, 900 reversed.
// Acknowledges immediately so SABVTU stops retrying.
// TODO (buy slice): match `reference` to the service_order, then complete or refund.
import { NextResponse } from "next/server";
export const runtime = "nodejs";

export async function POST(request) {
  let body = {};
  try { body = await request.json(); }
  catch (_) {
    try { const t = await request.text(); body = Object.fromEntries(new URLSearchParams(t)); } catch (__) {}
  }
  console.log("SABVTU webhook:", JSON.stringify(body));
  return NextResponse.json({ received: true });
}
