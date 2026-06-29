// POST /api/auth/register  { email, password, full_name, phone? }
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { hashPassword, signToken } from "@/lib/auth";
import { rateLimit, clientId } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const fullName = String(body.full_name || "").trim();
    const phone = String(body.phone || "").trim();
    const rl = await rateLimit("register", clientId(request), 5, 600);
    if (!rl.ok) return NextResponse.json({ success: false, error: "Too many attempts. Try again later." }, { status: 429 });

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ success: false, error: "Enter a valid email." }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ success: false, error: "Password must be at least 8 characters." }, { status: 400 });
    if (!fullName) return NextResponse.json({ success: false, error: "Enter your name." }, { status: 400 });

    const hash = await hashPassword(password);
    let userId;
    try {
      const { rows } = await pool.query("select register_user($1,$2,$3,$4) as id", [email, hash, fullName, phone]);
      userId = rows[0].id;
    } catch (e) {
      if (String(e.message || "").includes("ACCOUNT_EXISTS"))
        return NextResponse.json({ success: false, error: "An account with that email or phone already exists." }, { status: 409 });
      throw e;
    }

    const token = signToken(userId, "customer");
    return NextResponse.json({ success: true, token, user: { id: userId, email, full_name: fullName, role: "customer" } });
  } catch (e) {
    console.error("register error:", e);
    return NextResponse.json({ success: false, error: "Could not create account." }, { status: 500 });
  }
}
