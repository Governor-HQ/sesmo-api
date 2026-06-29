// POST /api/auth/reset-password { token, password }
import { NextResponse } from "next/server";
import { createHash } from "crypto";
import pool from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { rateLimit, clientId } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = String(body.token || "");
    const password = String(body.password || "");
    const rl = await rateLimit("reset", clientId(request), 10, 900);
    if (!rl.ok) return NextResponse.json({ success: false, error: "Too many attempts. Try again later." }, { status: 429 });
    if (password.length < 8) return NextResponse.json({ success: false, error: "Password must be at least 8 characters." }, { status: 400 });
    if (!token) return NextResponse.json({ success: false, error: "Invalid reset link." }, { status: 400 });

    const hash = createHash("sha256").update(token).digest("hex");
    const { rows } = await pool.query(
      "select id, user_id from password_reset_tokens where token_hash = $1 and used_at is null and expires_at > now() limit 1",
      [hash]
    );
    const row = rows[0];
    if (!row) return NextResponse.json({ success: false, error: "This reset link is invalid or has expired." }, { status: 400 });

    const pwHash = await hashPassword(password);
    await pool.query("update users set password_hash = $2 where id = $1", [row.user_id, pwHash]);
    await pool.query("update password_reset_tokens set used_at = now() where id = $1", [row.id]);
    // invalidate any other outstanding tokens for this user
    await pool.query("update password_reset_tokens set used_at = now() where user_id = $1 and used_at is null", [row.user_id]);
    return NextResponse.json({ success: true, message: "Password updated. You can now log in." });
  } catch (e) {
    console.error("reset-password error:", e);
    return NextResponse.json({ success: false, error: "Could not reset password." }, { status: 500 });
  }
}
