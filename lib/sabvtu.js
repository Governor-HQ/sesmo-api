// lib/sabvtu.js — server-side client for the SABVTU VTU API.
// Auth: API key in the URL path + transaction PIN in the body. BOTH are secrets
// and live only in environment variables (never the browser, never logs we expose).
const BASE = process.env.SABVTU_BASE_URL || "https://sabuss.com/vtu/api";

function apiKey() {
  const k = process.env.SABVTU_API_KEY;
  if (!k) throw new Error("SABVTU_API_KEY is not set");
  return k;
}
function pin() {
  const p = process.env.SABVTU_PIN;
  if (!p) throw new Error("SABVTU_PIN is not set");
  return p;
}

// All SABVTU calls are POST form-encoded with the pin, key appended to the path.
async function call(path, fields = {}) {
  const body = new URLSearchParams({ pin: pin(), ...fields });
  const res = await fetch(`${BASE}/${path}/${apiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch (_) { throw new Error("SABVTU returned non-JSON (" + res.status + "): " + text.slice(0, 180)); }
  return data;
}

export function getBalance() { return call("balance"); }

// category: 'data' | 'airtime' → returns an array of { plan_id, name, amount }
export function listPlans(category) { return call("plans", { category }); }

// Place a purchase. amount is required for airtime, omitted for data (plan sets price).
// Returns { code, status, product, response, reference } — usually code 400 "pending",
// with the FINAL status delivered later to the webhook.
export function buy({ plan_id, phone, amount, reference }) {
  const fields = { plan_id: String(plan_id), phone: String(phone), reference: String(reference) };
  if (amount != null && amount !== "") fields.amount = String(amount);
  return call("buy", fields);
}

// Poll a transaction's status by our reference (fallback if a webhook is missed).
export function queryTransaction(reference) { return call("query", { reference: String(reference) }); }

// SABVTU status codes
export const SABVTU_STATUS = { "200": "success", "400": "pending", "800": "failed", "900": "reversed" };
