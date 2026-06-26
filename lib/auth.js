// lib/auth.js — JWT verification. Returns { userId, payload } or null.
// The login endpoint (later slice) signs tokens with this same JWT_SECRET,
// putting the user id in `sub`.
import jwt from "jsonwebtoken";

export function getUserFromRequest(request) {
  try {
    const header = request.headers.get("authorization") || "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) return null;
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const userId = payload.sub || payload.userId;
    return userId ? { userId, payload } : null;
  } catch (_) {
    return null;
  }
}

// Admin gate: verify the token, then confirm the user's role IS admin in the
// database (we don't trust a role claim in the token alone). Returns the admin
// { userId } or null.
import pool from "@/lib/db";
export async function getAdminFromRequest(request) {
  const u = getUserFromRequest(request);
  if (!u) return null;
  const { rows } = await pool.query("select role from users where id = $1", [u.userId]);
  if (!rows[0] || rows[0].role !== "admin") return null;
  return { userId: u.userId, role: rows[0].role };
}

// ---- password hashing + token issuing (used by register/login) ----
import bcrypt from "bcryptjs";

export function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}
export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}
export function signToken(userId, role) {
  return jwt.sign({ sub: userId, role: role || "customer" }, process.env.JWT_SECRET, { expiresIn: "7d" });
}
