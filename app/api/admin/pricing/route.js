// GET /api/admin/pricing — manual products + VTU pricing config + live data plans (cost & resolved price).
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminFromRequest, hasPermission } from "@/lib/auth";
import { cachedPlans, detectNetwork, durationBucket } from "@/lib/sabvtu";
import { loadPricingConfig, resolvePriceKobo } from "@/lib/pricing";

export const runtime = "nodejs";

export async function GET(request) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ success: false, error: "Admin access required." }, { status: 403 });
  if (!hasPermission(admin, "products")) return NextResponse.json({ success: false, error: "You don\u2019t have the products permission." }, { status: 403 });

  const { rows: products } = await pool.query(
    "select id, category, provider, name, price_kobo, requires_smartcard, active from service_products order by category, provider, sort, name"
  );
  const cfg = await loadPricingConfig();

  let dataPlans = [];
  try {
    const raw = await cachedPlans("data");
    dataPlans = raw.map((p) => {
      const network = detectNetwork(p.name);
      return {
        plan_id: String(p.plan_id), name: p.name, network, duration: durationBucket(p.name),
        cost_naira: Number(p.amount),
        sell_kobo: resolvePriceKobo(String(p.plan_id), network, p.amount, cfg),
        fixed: cfg.overrides[String(p.plan_id)] != null,
      };
    });
  } catch (e) { /* plans optional; pricing config still returned */ }

  return NextResponse.json({
    success: true,
    products,
    vtu: {
      global_pct: cfg.globalPct,
      networks: Object.entries(cfg.networks).map(([network, percent]) => ({ network, percent })),
      overrides: Object.entries(cfg.overrides).map(([plan_id, price_kobo]) => ({ plan_id, price_kobo })),
    },
    dataPlans,
  });
}
