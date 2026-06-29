// lib/email.js — transactional email. Uses Resend when RESEND_API_KEY is set;
// otherwise logs to the server so flows still work in testing (never throws).
const KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || "SESMO Telecom <onboarding@resend.dev>";

export async function sendEmail({ to, subject, html, text }) {
  if (!KEY) {
    console.log("[email:dev] to=%s | subject=%s\n%s", to, subject, text || html);
    return { sent: false, dev: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html, text }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.message || "send failed");
    return { sent: true, id: d.id };
  } catch (e) {
    console.error("email error:", e);
    return { sent: false, error: e.message };
  }
}
