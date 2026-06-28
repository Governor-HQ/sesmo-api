// POST /api/webhooks/sabvtu — SABVTU delivery-status callbacks.
// code: 200 success, 400 pending, 800 failed, 900 reversed.
import { NextResponse } from "next/server";
import pool from "@/lib/db";
export const runtime = "nodejs";

export async function POST(request) {
  let body = {};
  try { body = await request.json(); }
  catch (_) { try { const t = await request.text(); body = Object.fromEntries(new URLSearchParams(t)); } catch (__) {} }

  try {
    const code = String(body.code || "");
    const status = String(body.status || "");
    const response = String(body.response || "");
    const ref = String(body.reference || "");
    if (ref) {
      // Match on our reference OR the provider's reference.
      const { rows } = await pool.query(
        "select reference, status from vtu_orders where reference=$1 or provider_reference=$1 limit 1", [ref]
      );
      const order = rows[0];
      if (order && order.status === "processing") {
        if (code === "200") await pool.query("select vtu_complete($1,$2,$3)", [order.reference, status || "success", response]);
        else if (code === "800" || code === "900") await pool.query("select vtu_refund($1,$2,$3)", [order.reference, status || "reversed", response]);
      }
    }
  } catch (e) { console.error("sabvtu webhook error:", e); }

  return NextResponse.json({ received: true }); // always ack so SABVTU stops retrying
}
