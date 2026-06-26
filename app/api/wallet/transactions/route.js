// GET /api/wallet/transactions?limit=20&before=<ISO> — ledger history, newest first.
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { getWalletByUserId } from "@/lib/wallet";

export const runtime = "nodejs";

export async function GET(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ success: false, error: "Please log in." }, { status: 401 });
  try {
    // Resolve wallet from the authenticated user, never from a client id, so a
    // user can only ever read their own transactions.
    const wallet = await getWalletByUserId(user.userId);
    if (!wallet) return NextResponse.json({ success: true, transactions: [], next_cursor: null });

    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit"), 10) || 20, 1), 100);
    const before = url.searchParams.get("before");

    const params = [wallet.id];
    let where = "wallet_id = $1";
    if (before) { params.push(before); where += ` and created_at < $${params.length}`; }
    params.push(limit + 1);

    const { rows } = await pool.query(
      `select id, type, amount, balance_after, reference, status, metadata, created_at
         from ledger_entries
        where ${where}
        order by created_at desc
        limit $${params.length}`,
      params
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return NextResponse.json({
      success: true,
      transactions: page.map((r) => ({
        id: r.id, type: r.type,
        amount_kobo: Number(r.amount), amount_naira: Number(r.amount) / 100,
        balance_after_kobo: Number(r.balance_after),
        reference: r.reference, status: r.status, metadata: r.metadata, created_at: r.created_at,
      })),
      next_cursor: hasMore ? page[page.length - 1].created_at : null,
    });
  } catch (e) {
    console.error("transactions GET error:", e);
    return NextResponse.json({ success: false, error: "Could not load activity." }, { status: 500 });
  }
}
