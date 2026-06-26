// lib/paystack.js — signature verification + transaction initialize.
import crypto from "node:crypto";

const PAYSTACK_BASE = "https://api.paystack.co";

// Verify a webhook is really from Paystack: HMAC-SHA512 over the RAW body,
// keyed with the secret key, constant-time compared to the header.
export function verifySignature(rawBody, signature) {
  if (!process.env.PAYSTACK_SECRET_KEY || !signature) return false;
  const hash = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(hash);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function initializeTransaction({ email, amountKobo, reference, metadata, callbackUrl }) {
  const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, amount: amountKobo, reference, metadata, callback_url: callbackUrl }),
  });
  const data = await res.json();
  if (!res.ok || !data.status) throw new Error(data.message || "Paystack initialize failed");
  return data.data;
}
