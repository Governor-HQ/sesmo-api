import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminFromRequest, hasPermission } from "@/lib/auth";
export const runtime = "nodejs";

export async function PATCH(request, { params }) {
  const admin = await getAdminFromRequest(request);
  if (!admin || !hasPermission(admin, "products")) return NextResponse.json({ success: false, error: "Products permission required." }, { status: 403 });
  try {
    const b = await request.json().catch(() => ({}));
    if (b.price_kobo != null) {
      const k = Math.trunc(Number(b.price_kobo));
      if (!Number.isFinite(k) || k <= 0) return NextResponse.json({ success: false, error: "Price must be greater than zero." }, { status: 400 });
      await pool.query("update service_products set price_kobo = $2 where id = $1", [params.id, k]);
    }
    if (typeof b.active === "boolean") await pool.query("update service_products set active = $2 where id = $1", [params.id, b.active]);
    return NextResponse.json({ success: true });
  } catch (e) { console.error("product patch:", e); return NextResponse.json({ success: false, error: "Could not update product." }, { status: 500 }); }
}
