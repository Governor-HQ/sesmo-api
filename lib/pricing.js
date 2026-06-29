// lib/pricing.js — VTU price resolution: fixed plan price > network markup > global markup.
import pool from "@/lib/db";

export async function loadPricingConfig() {
  const cfg = { globalPct: 5, networks: {}, overrides: {} };
  try {
    const g = await pool.query("select value from app_settings where key = 'vtu_markup_percent'");
    if (g.rows[0]) { const n = Number(g.rows[0].value); if (Number.isFinite(n) && n >= 0) cfg.globalPct = n; }
    const nm = await pool.query("select network, percent from vtu_network_markup");
    for (const r of nm.rows) cfg.networks[r.network] = Number(r.percent);
    const ov = await pool.query("select plan_id, price_kobo from vtu_plan_overrides");
    for (const r of ov.rows) cfg.overrides[String(r.plan_id)] = Number(r.price_kobo);
  } catch (e) { console.error("loadPricingConfig:", e); }
  return cfg;
}

export function resolvePriceKobo(planId, network, costNaira, cfg) {
  const fixed = cfg.overrides[String(planId)];
  if (fixed != null) return fixed;
  const pct = (network != null && cfg.networks[network] != null) ? cfg.networks[network] : cfg.globalPct;
  const cost = Number(costNaira);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  return Math.ceil(cost * (1 + pct / 100)) * 100;
}
