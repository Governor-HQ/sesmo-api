// POST /api/services/purchase  { product_id, quantity?, smartcard_number?, idempotency_key? }
// Atomic: deducts the wallet and queues a pending order in one DB transaction.
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import pool from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { ensureWallet } from "@/lib/wallet";

export const runtime = "nodejs";

export async function POST(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ success: false, error: "Please log in." }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const productId = body.product_id;
    const quantity = Math.max(parseInt(body.quantity, 10) || 1, 1);
    if (!productId) return NextResponse.json({ success: false, error: "Choose a service first." }, { status: 400 });

    const { rows: pr } = await pool.query(
      "select category, provider, name, requires_smartcard from service_products where id = $1 and active = true",
      [productId]
    );
    const product = pr[0];
    if (!product) return NextResponse.json({ success: false, error: "That service isn't available." }, { status: 400 });

    const details = {};
    if (product.requires_smartcard) {
      const sc = String(body.smartcard_number || "").replace(/\s/g, "");
      if (!/^[0-9]{8,12}$/.test(sc)) {
        return NextResponse.json({ success: false, error: "Enter a valid smartcard / decoder number." }, { status: 400 });
      }
      details.smartcard_number = sc;
    }

    const wallet = await ensureWallet(user.userId);
    const key = body.idempotency_key ? String(body.idempotency_key).slice(0, 80) : crypto.randomUUID();
    const reference = `SES-SRV-${key}`;

    const { rows } = await pool.query(
      `select service_purchase($1::uuid, $2::uuid, $3::uuid, $4::int, $5::jsonb, $6::text) as order_id`,
      [user.userId, wallet.id, productId, quantity, JSON.stringify(details), reference]
    );
    const { rows: o } = await pool.query(
      "select id, category, provider, amount, details, status, created_at from service_orders where id = $1",
      [rows[0].order_id]
    );
    const ord = o[0];
    return NextResponse.json({
      success: true,
      order: {
        id: ord.id, category: ord.category, provider: ord.provider,
        item: ord.details && ord.details.product_name, status: ord.status,
        amount_kobo: Number(ord.amount), amount_naira: Number(ord.amount) / 100,
        created_at: ord.created_at,
      },
    });
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.includes("INSUFFICIENT_FUNDS"))
      return NextResponse.json({ success: false, error: "Not enough balance. Add money and try again." }, { status: 400 });
    if (msg.includes("PRODUCT_UNAVAILABLE"))
      return NextResponse.json({ success: false, error: "That service isn't available." }, { status: 400 });
    console.error("purchase error:", e);
    return NextResponse.json({ success: false, error: "Could not complete purchase." }, { status: 500 });
  }
}
