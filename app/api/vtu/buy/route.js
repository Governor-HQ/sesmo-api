// POST /api/vtu/buy { category, network, plan_id, phone, amount? }
// Debits the SESMO wallet, places the SABVTU order, and resolves the immediate
// outcome. Final delivery status arrives later at the webhook.
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { rateLimit, clientId } from "@/lib/ratelimit";
import { buy, queryTransaction, findDataPlan, detectNetwork, normalizePhone, isValidPhone, AIRTIME_NETWORKS } from "@/lib/sabvtu";
import { loadPricingConfig, resolvePriceKobo } from "@/lib/pricing";

export const runtime = "nodejs";
// SABVTU rejects references containing hyphens, so keep this strictly alphanumeric.
const newRef = () => "SESVTU" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase();

export async function POST(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ success: false, error: "Please log in." }, { status: 401 });
  try {
    const rl = await rateLimit("vtubuy", user.userId, 20, 300);
    if (!rl.ok) return NextResponse.json({ success: false, error: "Too many requests. Slow down a moment." }, { status: 429 });
    const b = await request.json().catch(() => ({}));
    const category = b.category === "airtime" ? "airtime" : b.category === "data" ? "data" : null;
    const phone = normalizePhone(b.phone);
    if (!category) return NextResponse.json({ success: false, error: "Choose airtime or data." }, { status: 400 });
    if (!isValidPhone(phone)) return NextResponse.json({ success: false, error: "Enter a valid 11-digit phone number." }, { status: 400 });

    let planId = String(b.plan_id || "");
    let network, planName, sellKobo, airtimeAmountNaira;

    if (category === "airtime") {
      const net = AIRTIME_NETWORKS.find((n) => n.plan_id === planId);
      if (!net) return NextResponse.json({ success: false, error: "Choose a network." }, { status: 400 });
      const amt = Math.trunc(Number(b.amount));
      if (!Number.isFinite(amt) || amt < 50 || amt > 50000) return NextResponse.json({ success: false, error: "Amount must be between ₦50 and ₦50,000." }, { status: 400 });
      network = net.network; planName = net.network + " Airtime"; sellKobo = amt * 100; airtimeAmountNaira = amt;
    } else {
      const plan = await findDataPlan(planId);
      if (!plan) return NextResponse.json({ success: false, error: "That data plan is unavailable." }, { status: 400 });
      network = detectNetwork(plan.name); planName = plan.name;
      const cfg = await loadPricingConfig();
      sellKobo = resolvePriceKobo(String(planId), network, plan.amount, cfg);
      if (!sellKobo) return NextResponse.json({ success: false, error: "That data plan is unavailable." }, { status: 400 });
    }

    const reference = newRef();

    // 1) atomic debit + processing order (raises INSUFFICIENT_FUNDS)
    try {
      await pool.query("select vtu_purchase($1::uuid,$2::bigint,$3,$4,$5,$6,$7,$8) as id",
        [user.userId, sellKobo, category, network, planId, planName, phone, reference]);
    } catch (e) {
      const msg = String(e.message || "");
      if (msg.includes("INSUFFICIENT_FUNDS")) return NextResponse.json({ success: false, error: "Your wallet balance is too low for this." }, { status: 400 });
      if (msg.includes("WALLET_NOT_FOUND")) return NextResponse.json({ success: false, error: "Wallet not found." }, { status: 400 });
      throw e;
    }

    // 2) place the order with SABVTU
    let resp;
    try {
      resp = await buy({ plan_id: planId, phone, amount: category === "airtime" ? airtimeAmountNaira : undefined, reference });
    } catch (err) {
      // Couldn't get a response — reconcile via query before deciding.
      try {
        const q = await queryTransaction(reference);
        resp = q;
      } catch (_) {
        // Still unknown: leave it processing for the webhook/admin to resolve.
        return NextResponse.json({ success: true, status: "processing", reference, message: "Order placed — confirming delivery." });
      }
    }

    const code = String(resp && resp.code || "");
    const providerRef = (resp && resp.reference) || null;
    if (providerRef) await pool.query("update vtu_orders set provider_reference=$2 where reference=$1", [reference, providerRef]);

    if (code === "200") {
      await pool.query("select vtu_complete($1,$2,$3)", [reference, "success", (resp && resp.response) || "Delivered"]);
      return NextResponse.json({ success: true, status: "completed", reference, message: (resp && resp.response) || "Delivered." });
    }
    if (code === "400") {
      // pending (the usual case) — webhook finalizes
      return NextResponse.json({ success: true, status: "processing", reference, message: (resp && resp.response) || "Order placed — delivering now." });
    }
    // 800 failed, 900 reversed, OR any error/unknown response -> refund and surface the provider's exact reason
    const reason = (resp && resp.response) ? String(resp.response) : ("Provider rejected the order" + (code ? " (code " + code + ")" : ""));
    console.error("vtu buy failed:", reference, reason); // raw reason -> server logs / admin
    await pool.query("select vtu_refund($1,$2,$3)", [reference, (resp && resp.status) || "failed", reason]);
    return NextResponse.json({ success: true, status: "failed", refunded: true, reference, message: "This order couldn't be completed, so your money was refunded." });
  } catch (e) {
    console.error("vtu buy error:", e);
    return NextResponse.json({ success: false, error: "Could not complete the purchase." }, { status: 500 });
  }
}
