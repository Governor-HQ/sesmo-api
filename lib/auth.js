// lib/auth.js — JWT verification, admin/RBAC gates, password + token helpers.
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";

// Verify the bearer token. Returns { userId, payload } or null.
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

// Admin gate: verify the token, then confirm the role IS admin/super_admin in
// the DB (never trust the token's role claim alone). Returns the admin with
// role + permissions, or null.
export async function getAdminFromRequest(request) {
  const u = getUserFromRequest(request);
  if (!u) return null;
  const { rows } = await pool.query(
    "select id, full_name, role, permissions, status from users where id = $1",
    [u.userId]
  );
  const row = rows[0];
  if (!row || (row.role !== "admin" && row.role !== "super_admin") || row.status !== "active") return null;
  return {
    userId: row.id,
    fullName: row.full_name,
    role: row.role,
    permissions: row.permissions || [],
    isSuper: row.role === "super_admin",
  };
}

// Permission check: super_admin implicitly has every permission.
export function hasPermission(admin, perm) {
  return !!admin && (admin.isSuper || (admin.permissions || []).includes(perm));
}

// ---- password hashing + token issuing ----
export function hashPassword(plain) { return bcrypt.hash(plain, 10); }
export function verifyPassword(plain, hash) { return bcrypt.compare(plain, hash); }
export function signToken(userId, role) {
  return jwt.sign({ sub: userId, role: role || "customer" }, process.env.JWT_SECRET, { expiresIn: "7d" });
}
