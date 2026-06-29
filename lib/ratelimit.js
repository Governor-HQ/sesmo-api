// lib/ratelimit.js — fixed-window limiter backed by Upstash Redis REST.
// If Upstash isn't configured, OR if Redis errors, it FAILS OPEN (allows the
// request) so legitimate users are never blocked by our infrastructure.
const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export function clientIp(request) {
  const xff = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "";
  return (xff.split(",")[0] || "").trim() || "unknown";
}
export function clientId(request, extra) {
  return clientIp(request) + (extra ? ":" + String(extra).toLowerCase() : "");
}

async function redis(cmd) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const d = await res.json();
  return d.result;
}

export async function rateLimit(bucket, id, limit, windowSec) {
  if (!URL || !TOKEN) return { ok: true, remaining: limit };
  try {
    const key = `rl:${bucket}:${id}`;
    const n = await redis(["INCR", key]);
    if (n === 1) await redis(["EXPIRE", key, String(windowSec)]);
    return { ok: n <= limit, remaining: Math.max(0, limit - n) };
  } catch (_) {
    return { ok: true, remaining: limit }; // fail open
  }
}
