import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminFromRequest, hasPermission } from "@/lib/auth";
export const runtime = "nodejs";

export async function PUT(request) {
  const admin = await getAdminFromRequest(request);
  if (!admin || !hasPermission(admin, "products")) return NextResponse.json({ success: false, error: "Products permission required." }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const pct = Number(b.percent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return NextResponse.json({ success: false, error: "Markup must be between 0 and 100." }, { status: 400 });
  await pool.query("insert into app_settings (key, value, updated_at) values ('vtu_markup_percent', $1, now()) on conflict (key) do update set value = excluded.value, updated_at = now()", [String(pct)]);
  return NextResponse.json({ success: true });
}
