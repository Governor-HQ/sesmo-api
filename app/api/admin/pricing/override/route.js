import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminFromRequest, hasPermission } from "@/lib/auth";
export const runtime = "nodejs";

export async function PUT(request) {
  const admin = await getAdminFromRequest(request);
  if (!admin || !hasPermission(admin, "products")) return NextResponse.json({ success: false, error: "Products permission required." }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const plan_id = String(b.plan_id || "").trim();
  if (!plan_id) return NextResponse.json({ success: false, error: "plan_id required." }, { status: 400 });
  if (b.price_kobo == null || b.price_kobo === "") {
    await pool.query("delete from vtu_plan_overrides where plan_id = $1", [plan_id]); // revert to markup
    return NextResponse.json({ success: true, cleared: true });
  }
  const k = Math.trunc(Number(b.price_kobo));
  if (!Number.isFinite(k) || k <= 0) return NextResponse.json({ success: false, error: "Price must be greater than zero." }, { status: 400 });
  await pool.query(
    "insert into vtu_plan_overrides (plan_id, network, name, price_kobo, updated_at) values ($1,$2,$3,$4, now()) on conflict (plan_id) do update set network = excluded.network, name = excluded.name, price_kobo = excluded.price_kobo, updated_at = now()",
    [plan_id, String(b.network || ""), String(b.name || ""), k]
  );
  return NextResponse.json({ success: true });
}
