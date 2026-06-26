// GET /api/admin/orders?status=pending — the fulfilment queue (all customers).
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ success: false, error: "Admin access required." }, { status: 403 });
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "pending";
    const { rows } = await pool.query(
      `select o.id, o.category, o.provider, o.amount, o.details, o.status,
              o.result, o.admin_note, o.created_at, o.fulfilled_at,
              u.email as customer_email, u.full_name as customer_name
         from service_orders o
         join users u on u.id = o.user_id
        where o.status = $1
        order by o.created_at asc
        limit 100`,
      [status]
    );
    return NextResponse.json({
      success: true,
      orders: rows.map((r) => ({
        id: r.id, category: r.category, provider: r.provider,
        item: r.details && r.details.product_name,
        smartcard: (r.details && r.details.smartcard_number) || null,
        quantity: (r.details && r.details.quantity) || 1,
        amount_kobo: Number(r.amount), amount_naira: Number(r.amount) / 100,
        status: r.status, result: r.result, admin_note: r.admin_note,
        customer_email: r.customer_email, customer_name: r.customer_name,
        created_at: r.created_at, fulfilled_at: r.fulfilled_at,
      })),
    });
  } catch (e) {
    console.error("admin orders GET error:", e);
    return NextResponse.json({ success: false, error: "Could not load queue." }, { status: 500 });
  }
}
