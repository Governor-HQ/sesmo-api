// POST /api/auth/forgot-password { email } — always responds the same (no account enumeration).
import { NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import pool from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { rateLimit, clientId } from "@/lib/ratelimit";

export const runtime = "nodejs";
const GENERIC = { success: true, message: "If that email is registered, a reset link is on its way." };

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const rl = await rateLimit("forgot", clientId(request, email), 3, 900); // 3 / 15 min
    if (!rl.ok) return NextResponse.json({ success: false, error: "Too many requests. Try again later." }, { status: 429 });
    if (!email) return NextResponse.json(GENERIC);

    const { rows } = await pool.query("select id, full_name from users where email = $1", [email]);
    const user = rows[0];
    if (user) {
      const raw = randomBytes(32).toString("hex");
      const hash = createHash("sha256").update(raw).digest("hex");
      await pool.query(
        "insert into password_reset_tokens (user_id, token_hash, expires_at) values ($1,$2, now() + interval '1 hour')",
        [user.id, hash]
      );
      const base = process.env.FRONTEND_URL || "https://sesmo-telecom.netlify.app";
      const link = `${base}/pages/reset-password.html?token=${raw}`;
      await sendEmail({
        to: email,
        subject: "Reset your SESMO Telecom password",
        text: `Hi ${user.full_name || ""},\n\nReset your password using the link below (valid for 1 hour):\n${link}\n\nIf you didn't request this, you can ignore this email.`,
        html: `<p>Hi ${user.full_name || ""},</p><p>Reset your password using the link below (valid for 1 hour):</p><p><a href="${link}">Reset my password</a></p><p>If you didn't request this, you can ignore this email.</p>`,
      });
    }
    return NextResponse.json(GENERIC);
  } catch (e) {
    console.error("forgot-password error:", e);
    return NextResponse.json(GENERIC); // never leak internal state
  }
}
