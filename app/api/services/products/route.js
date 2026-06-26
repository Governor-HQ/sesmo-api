// GET /api/services/products — the active catalogue.
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ success: false, error: "Please log in." }, { status: 401 });
  try {
    const { rows } = await pool.query(
      `select id, category, provider, name, price, requires_smartcard
         from service_products where active = true
        order by sort, provider, price`
    );
    return NextResponse.json({
      success: true,
      products: rows.map((r) => ({
        id: r.id, category: r.category, provider: r.provider, name: r.name,
        price_kobo: Number(r.price), price_naira: Number(r.price) / 100,
        requires_smartcard: r.requires_smartcard,
      })),
    });
  } catch (e) {
    console.error("products GET error:", e);
    return NextResponse.json({ success: false, error: "Could not load services." }, { status: 500 });
  }
}
