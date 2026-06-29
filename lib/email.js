// lib/email.js — transactional email.
// Order of preference: Brevo (works with a verified single sender, NO domain needed)
// -> Resend (needs a verified domain) -> console log (test mode). Never throws.
const BREVO_KEY = process.env.BREVO_API_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || "SESMO Telecom <onboarding@resend.dev>";

function parseFrom() {
  const m = FROM.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || "SESMO Telecom", email: m[2].trim() };
  return { name: "SESMO Telecom", email: FROM.trim() };
}

export async function sendEmail({ to, subject, html, text }) {
  // Brevo first — no custom domain required, just a verified sender address.
  if (BREVO_KEY) {
    try {
      const f = parseFrom();
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": BREVO_KEY, "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sender: f, to: [{ email: to }], subject, htmlContent: html, textContent: text }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "brevo send failed");
      return { sent: true, id: d.messageId };
    } catch (e) { console.error("brevo email error:", e); return { sent: false, error: e.message }; }
  }
  if (RESEND_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to, subject, html, text }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "send failed");
      return { sent: true, id: d.id };
    } catch (e) { console.error("resend email error:", e); return { sent: false, error: e.message }; }
  }
  console.log("[email:dev] to=%s | subject=%s\n%s", to, subject, text || html);
  return { sent: false, dev: true };
}
