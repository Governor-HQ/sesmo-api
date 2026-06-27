// GET /api/admin/withdrawals?status=pending — the payout queue.
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminFromRequest, hasPermission } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ success: false, error: "Admin access required." }, { status: 403 });
  if (!hasPermission(admin, "withdrawals")) return NextResponse.json({ success: false, error: "You don\u2019t have permission for this." }, { status: 403 });
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "pending";
    const { rows } = await pool.query(
      `select w.id, w.amount, w.bank_name, w.account_number, w.account_name, w.status,
              w.admin_note, w.created_at, w.processed_at,
              u.email as customer_email, u.full_name as customer_name
         from withdrawals w join users u on u.id = w.user_id
        where w.status = $1 order by w.created_at asc limit 100`,
      [status]
    );
    return NextResponse.json({
      success: true,
      withdrawals: rows.map((w) => ({
        id: w.id, amount_kobo: Number(w.amount), amount_naira: Number(w.amount) / 100,
        bank_name: w.bank_name, account_number: w.account_number, account_name: w.account_name,
        status: w.status, admin_note: w.admin_note,
        customer_email: w.customer_email, customer_name: w.customer_name,
        created_at: w.created_at, processed_at: w.processed_at,
      })),
    });
  } catch (e) {
    console.error("admin withdrawals GET error:", e);
    return NextResponse.json({ success: false, error: "Could not load payouts." }, { status: 500 });
  }
}
