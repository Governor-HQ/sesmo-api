// PATCH /api/admin/staff/[id] { permissions?[], status? } — super_admin only.
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
const ALLOWED = ["orders", "withdrawals", "products", "staff"];

export async function PATCH(request, { params }) {
  const admin = await getAdminFromRequest(request);
  if (!admin || !admin.isSuper) return NextResponse.json({ success: false, error: "Super-admin only." }, { status: 403 });
  try {
    const { rows: tr } = await pool.query("select id, role from users where id = $1", [params.id]);
    const target = tr[0];
    if (!target) return NextResponse.json({ success: false, error: "Staff not found." }, { status: 404 });
    if (target.role === "super_admin") return NextResponse.json({ success: false, error: "The super-admin account can't be modified here." }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    if (Array.isArray(body.permissions)) {
      const perms = body.permissions.filter((p) => ALLOWED.includes(p));
      await pool.query("update users set permissions = $2::text[] where id = $1", [params.id, perms]);
    }
    if (body.status === "active" || body.status === "suspended") {
      await pool.query("update users set status = $2 where id = $1", [params.id, body.status]);
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("update staff error:", e);
    return NextResponse.json({ success: false, error: "Could not update staff." }, { status: 500 });
  }
}
