// POST /api/admin/orders/[id]/reject  { note?: "<reason>" } -> refunds the wallet.
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ success: false, error: "Admin access required." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const note = String(body.note || "").trim() || null;

    await pool.query(
      `select refund_service_order($1::uuid, $2::uuid, $3::text)`,
      [params.id, admin.userId, note]
    );
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.includes("ORDER_NOT_PENDING"))
      return NextResponse.json({ success: false, error: "That order is no longer pending." }, { status: 409 });
    if (msg.includes("ORDER_NOT_FOUND"))
      return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
    console.error("reject error:", e);
    return NextResponse.json({ success: false, error: "Could not reject order." }, { status: 500 });
  }
}
