// POST /api/admin/withdrawals/[id]/reject  { note? } — reject and refund the held funds.
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminFromRequest, hasPermission } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ success: false, error: "Admin access required." }, { status: 403 });
  if (!hasPermission(admin, "withdrawals")) return NextResponse.json({ success: false, error: "You don\u2019t have permission for this." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const note = String(body.note || "").trim() || null;
    await pool.query(`select reject_withdrawal($1::uuid,$2::uuid,$3::text)`, [params.id, admin.userId, note]);
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.includes("WITHDRAWAL_NOT_PENDING"))
      return NextResponse.json({ success: false, error: "That withdrawal is no longer pending." }, { status: 409 });
    if (msg.includes("WITHDRAWAL_NOT_FOUND"))
      return NextResponse.json({ success: false, error: "Withdrawal not found." }, { status: 404 });
    console.error("reject withdrawal error:", e);
    return NextResponse.json({ success: false, error: "Could not reject." }, { status: 500 });
  }
}
