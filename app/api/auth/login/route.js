// POST /api/auth/login  { email, password }
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
      "select id, email, password_hash, full_name, role, status from users where email = $1", [email]
    );
    const user = rows[0];
    // Generic message either way — don't reveal whether the email exists.
    if (!user || !user.password_hash) return NextResponse.json({ success: false, error: "Invalid email or password." }, { status: 401 });
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return NextResponse.json({ success: false, error: "Invalid email or password." }, { status: 401 });
    if (user.status !== "active") return NextResponse.json({ success: false, error: "This account is suspended." }, { status: 403 });

    const token = signToken(user.id, user.role);
    return NextResponse.json({ success: true, token, user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role } });
  } catch (e) {
    console.error("login error:", e);
    return NextResponse.json({ success: false, error: "Could not sign in." }, { status: 500 });
  }
}
