import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminFromRequest, hasPermission } from "@/lib/auth";
export const runtime = "nodejs";

export async function PUT(request) {
  const admin = await getAdminFromRequest(request);
  if (!admin || !hasPermission(admin, "products")) return NextResponse.json({ success: false, error: "Products permission required." }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const network = String(b.network || "").trim();
  if (!network) return NextResponse.json({ success: false, error: "Network required." }, { status: 400 });
  if (b.percent == null || b.percent === "") {
    await pool.query("delete from vtu_network_markup where network = $1", [network]); // revert to global
    return NextResponse.json({ success: true, cleared: true });
  }
  const pct = Number(b.percent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return NextResponse.json({ success: false, error: "Markup must be between 0 and 100." }, { status: 400 });
  await pool.query("insert into vtu_network_markup (network, percent, updated_at) values ($1,$2, now()) on conflict (network) do update set percent = excluded.percent, updated_at = now()", [network, pct]);
  return NextResponse.json({ success: true });
}
