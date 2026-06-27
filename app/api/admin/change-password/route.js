// POST /api/admin/change-password { current_password, new_password }
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminFromRequest, verifyPassword, hashPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ success: false, error: "Admin access required." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const current = String(body.current_password || "");
    const next = String(body.new_password || "");
    if (next.length < 8) return NextResponse.json({ success: false, error: "New password must be at least 8 characters." }, { status: 400 });

    const { rows } = await pool.query("select password_hash from users where id = $1", [admin.userId]);
    const ok = rows[0] && rows[0].password_hash && (await verifyPassword(current, rows[0].password_hash));
    if (!ok) return NextResponse.json({ success: false, error: "Current password is incorrect." }, { status: 401 });

    const hash = await hashPassword(next);
    await pool.query("update users set password_hash = $2, must_change_password = false where id = $1", [admin.userId, hash]);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("change password error:", e);
    return NextResponse.json({ success: false, error: "Could not change password." }, { status: 500 });
  }
}
