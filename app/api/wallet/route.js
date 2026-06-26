// GET /api/wallet — the authenticated user's balance.
import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { ensureWallet } from "@/lib/wallet";

export const runtime = "nodejs";

export async function GET(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ success: false, error: "Please log in." }, { status: 401 });
  try {
    // Ownership: scoped to the token's user id — never a client-supplied id.
    const w = await ensureWallet(user.userId);
    const kobo = Number(w.balance);
    return NextResponse.json({
      success: true, wallet_id: w.id, balance_kobo: kobo,
      balance_naira: kobo / 100, currency: w.currency,
    });
  } catch (e) {
    console.error("wallet GET error:", e);
    return NextResponse.json({ success: false, error: "Could not load wallet." }, { status: 500 });
  }
}
