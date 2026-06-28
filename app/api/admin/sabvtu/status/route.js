// GET /api/admin/sabvtu/status — super-admin connectivity check.
// Confirms the API key + PIN work and returns the live plan catalogue.
import { NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth";
import { getBalance, listPlans } from "@/lib/sabvtu";

export const runtime = "nodejs";

export async function GET(request) {
  const admin = await getAdminFromRequest(request);
  if (!admin || !admin.isSuper) return NextResponse.json({ success: false, error: "Super-admin only." }, { status: 403 });

  const out = { success: true };
  try { out.balance = await getBalance(); }
  catch (e) { out.success = false; out.balanceError = e.message; }
  try { out.dataPlans = await listPlans("data"); }
  catch (e) { out.dataPlansError = e.message; }
  try { out.airtimePlans = await listPlans("airtime"); }
  catch (e) { out.airtimePlansError = e.message; }

  return NextResponse.json(out, { status: out.success ? 200 : 502 });
}
