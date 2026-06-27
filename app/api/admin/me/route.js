// GET /api/admin/me — identity + permissions for the portal to render itself.
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ success: false, error: "Admin access required." }, { status: 403 });
  const { rows } = await pool.query("select must_change_password, email from users where id = $1", [admin.userId]);
  return NextResponse.json({
    success: true,
    admin: {
      id: admin.userId, email: rows[0] && rows[0].email, full_name: admin.fullName,
      role: admin.role, permissions: admin.permissions,
      must_change_password: rows[0] ? rows[0].must_change_password : false,
    },
  });
}
