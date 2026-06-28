// GET /api/vtu/plans?category=data|airtime — customer-facing catalogue (selling prices only).
import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { cachedPlans, sellingKoboForData, detectNetwork, AIRTIME_NETWORKS } from "@/lib/sabvtu";

export const runtime = "nodejs";

export async function GET(request) {
  if (!getUserFromRequest(request)) return NextResponse.json({ success: false, error: "Please log in." }, { status: 401 });
  const category = new URL(request.url).searchParams.get("category") || "data";
  try {
    if (category === "airtime") return NextResponse.json({ success: true, category, networks: AIRTIME_NETWORKS });
    if (category !== "data") return NextResponse.json({ success: false, error: "Unknown category." }, { status: 400 });

    const raw = await cachedPlans("data");
    const plans = raw
      .map((p) => ({ plan_id: String(p.plan_id), name: p.name, network: detectNetwork(p.name), sell_kobo: sellingKoboForData(p.amount) }))
      .filter((p) => p.sell_kobo);
    return NextResponse.json({ success: true, category, plans });
  } catch (e) {
    console.error("vtu plans error:", e);
    return NextResponse.json({ success: false, error: "Could not load plans right now." }, { status: 502 });
  }
}
