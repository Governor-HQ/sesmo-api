// GET  /api/admin/staff — list staff (super_admin only)
// POST /api/admin/staff { full_name, email, password, permissions[] } — create staff
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminFromRequest, hashPassword } from "@/lib/auth";

export const runtime = "nodejs";
const ALLOWED = ["orders", "withdrawals", "products", "staff"];

export async function GET(request) {
  const admin = await getAdminFromRequest(request);
  if (!admin || !admin.isSuper) return NextResponse.json({ success: false, error: "Super-admin only." }, { status: 403 });
  const { rows } = await pool.query(
    "select id, email, full_name, role, permissions, status, must_change_password, created_at from users where role in ('admin','super_admin') order by created_at"
  );
  return NextResponse.json({
    success: true,
    staff: rows.map((r) => ({
      id: r.id, email: r.email, full_name: r.full_name, role: r.role,
      permissions: r.permissions || [], status: r.status,
      must_change_password: r.must_change_password, created_at: r.created_at,
    })),
  });
}

export async function POST(request) {
  const admin = await getAdminFromRequest(request);
  if (!admin || !admin.isSuper) return NextResponse.json({ success: false, error: "Super-admin only." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const full_name = String(body.full_name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    let permissions = Array.isArray(body.permissions) ? body.permissions.filter((p) => ALLOWED.includes(p)) : [];
    if (!full_name) return NextResponse.json({ success: false, error: "Enter the staff member's name." }, { status: 400 });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ success: false, error: "Enter a valid email." }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ success: false, error: "Temporary password must be at least 8 characters." }, { status: 400 });

    const hash = await hashPassword(password);
    let id;
    try {
      const { rows } = await pool.query("select create_staff($1,$2,$3,$4::text[]) as id", [email, hash, full_name, permissions]);
      id = rows[0].id;
    } catch (e) {
      if (String(e.message || "").includes("ACCOUNT_EXISTS")) return NextResponse.json({ success: false, error: "An account with that email already exists." }, { status: 409 });
      throw e;
    }
    return NextResponse.json({ success: true, staff: { id, email, full_name, role: "admin", permissions, status: "active", must_change_password: true } });
  } catch (e) {
    console.error("create staff error:", e);
    return NextResponse.json({ success: false, error: "Could not create staff." }, { status: 500 });
  }
}
