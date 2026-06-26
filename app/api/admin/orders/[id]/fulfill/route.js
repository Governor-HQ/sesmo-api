// POST /api/admin/orders/[id]/fulfill  { result: "<PIN / confirmation text>" }
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ success: false, error: "Admin access required." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const result = String(body.result || "").trim();
    if (!result) return NextResponse.json({ success: false, error: "Enter the PIN / confirmation to deliver." }, { status: 400 });

    await pool.query(
      `select fulfill_service_order($1::uuid, $2::uuid, $3::jsonb)`,
      [params.id, admin.userId, JSON.stringify(result)]
    );
    return NextResponse.json({ success: true });
  } catch (e) {
    if (String(e.message || "").includes("ORDER_NOT_PENDING"))
      return NextResponse.json({ success: false, error: "That order is no longer pending." }, { status: 409 });
    console.error("fulfill error:", e);
    return NextResponse.json({ success: false, error: "Could not fulfil order." }, { status: 500 });
  }
}
