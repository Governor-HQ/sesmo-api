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

// ---- pricing & helpers ----
export function markupPercent() {
  const m = Number(process.env.SABVTU_MARKUP_PERCENT);
  return Number.isFinite(m) && m >= 0 ? m : 5; // default 5% on data
}
// Customer price for a data plan = SABVTU cost + markup, rounded up to whole naira. Returns kobo.
export function sellingKoboForData(costNaira) {
  const cost = Number(costNaira);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  const sellNaira = Math.ceil(cost * (1 + markupPercent() / 100));
  return sellNaira * 100;
}
export function detectNetwork(name) {
  const n = String(name || "").toUpperCase();
  if (n.includes("9MOBILE") || n.includes("ETISALAT")) return "9mobile";
  if (n.includes("AIRTEL")) return "Airtel";
  if (n.includes("GLO")) return "Glo";
  if (n.includes("SMILE")) return "Smile";
  if (n.includes("SPECTRANET")) return "Spectranet";
  if (n.includes("MTN")) return "MTN";
  return "Other";
}
export function normalizePhone(p) {
  let s = String(p || "").replace(/\D/g, "");
  if (s.startsWith("234")) s = "0" + s.slice(3);
  if (s.length === 10 && !s.startsWith("0")) s = "0" + s;
  return s;
}
export function isValidPhone(p) { return /^0\d{10}$/.test(normalizePhone(p)); }

export const AIRTIME_NETWORKS = [
  { plan_id: "10", network: "MTN" },
  { plan_id: "11", network: "Airtel" },
  { plan_id: "12", network: "Glo" },
  { plan_id: "1651", network: "9mobile" },
];

// short-lived in-memory plan cache (per warm instance)
const _cache = {};
export async function cachedPlans(category) {
  const now = Date.now();
  const hit = _cache[category];
  if (hit && now - hit.ts < 5 * 60 * 1000) return hit.plans;
  const plans = await listPlans(category);
  _cache[category] = { plans: Array.isArray(plans) ? plans : [], ts: now };
  return _cache[category].plans;
}
export async function findDataPlan(planId) {
  const plans = await cachedPlans("data");
  return plans.find((p) => String(p.plan_id) === String(planId)) || null;
}
