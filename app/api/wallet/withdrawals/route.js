// GET /api/wallet/withdrawals — the authenticated user's withdrawal requests.
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ success: false, error: "Please log in." }, { status: 401 });
  try {
    const { rows } = await pool.query(
      `select id, amount, bank_name, account_number, account_name, status, admin_note, created_at, processed_at
         from withdrawals where user_id = $1 order by created_at desc limit 50`,
      [user.userId]
    );
    return NextResponse.json({
      success: true,
      withdrawals: rows.map((w) => ({
        id: w.id, amount_kobo: Number(w.amount), amount_naira: Number(w.amount) / 100,
        bank_name: w.bank_name, account_number: w.account_number, account_name: w.account_name,
        status: w.status, admin_note: w.admin_note, created_at: w.created_at, processed_at: w.processed_at,
      })),
    });
  } catch (e) {
    console.error("withdrawals GET error:", e);
    return NextResponse.json({ success: false, error: "Could not load withdrawals." }, { status: 500 });
  }
}
