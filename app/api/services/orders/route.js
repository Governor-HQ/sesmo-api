// GET /api/services/orders — the authenticated user's service orders.
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ success: false, error: "Please log in." }, { status: 401 });
  try {
    // Ownership: scoped to the token's user id.
    const { rows } = await pool.query(
      `select id, category, provider, amount, details, status, result, created_at, fulfilled_at
         from service_orders where user_id = $1
        order by created_at desc limit 50`,
      [user.userId]
    );
    return NextResponse.json({
      success: true,
      orders: rows.map((r) => ({
        id: r.id, category: r.category, provider: r.provider,
        item: r.details && r.details.product_name,
        smartcard: (r.details && r.details.smartcard_number) || null,
        amount_kobo: Number(r.amount), amount_naira: Number(r.amount) / 100,
        status: r.status, result: r.result,
        created_at: r.created_at, fulfilled_at: r.fulfilled_at,
      })),
    });
  } catch (e) {
    console.error("orders GET error:", e);
    return NextResponse.json({ success: false, error: "Could not load orders." }, { status: 500 });
  }
}
