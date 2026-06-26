// GET /api/auth/me — the current user's profile.
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request) {
  const u = getUserFromRequest(request);
  if (!u) return NextResponse.json({ success: false, error: "Please log in." }, { status: 401 });
  try {
    const { rows } = await pool.query("select id, email, full_name, phone, role from users where id = $1", [u.userId]);
    if (!rows[0]) return NextResponse.json({ success: false, error: "User not found." }, { status: 404 });
    return NextResponse.json({ success: true, user: rows[0] });
  } catch (e) {
    console.error("me error:", e);
    return NextResponse.json({ success: false, error: "Could not load profile." }, { status: 500 });
  }
}
