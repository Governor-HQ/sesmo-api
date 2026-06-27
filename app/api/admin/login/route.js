// POST /api/admin/login { email, password } — admin portal sign-in.
// Refuses customer accounts outright, so a customer credential can't get an
// admin session even by hitting this endpoint.
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { verifyPassword, signToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) return NextResponse.json({ success: false, error: "Enter your email and password." }, { status: 400 });

    const { rows } = await pool.query(
      "select id, email, password_hash, full_name, role, permissions, status, must_change_password from users where email = $1",
      [email]
    );
    const u = rows[0];
    if (!u || !u.password_hash) return NextResponse.json({ success: false, error: "Invalid email or password." }, { status: 401 });
    const ok = await verifyPassword(password, u.password_hash);
    if (!ok) return NextResponse.json({ success: false, error: "Invalid email or password." }, { status: 401 });
    if (u.role !== "admin" && u.role !== "super_admin") return NextResponse.json({ success: false, error: "This is not an admin account." }, { status: 403 });
    if (u.status !== "active") return NextResponse.json({ success: false, error: "This admin account is suspended." }, { status: 403 });

    const token = signToken(u.id, u.role);
    return NextResponse.json({
      success: true, token, must_change_password: u.must_change_password,
      admin: { id: u.id, email: u.email, full_name: u.full_name, role: u.role, permissions: u.permissions || [] },
    });
  } catch (e) {
    console.error("admin login error:", e);
    return NextResponse.json({ success: false, error: "Could not sign in." }, { status: 500 });
  }
}
