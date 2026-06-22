import { logger } from "./logger";

// Render's free tier blocks outbound SMTP, so we send through Brevo's HTTPS API
// (port 443) instead of nodemailer/Gmail. Configure BREVO_API_KEY + a verified
// sender address (EMAIL_FROM, falling back to SMTP_USER if that's still set).
// Sending is a no-op when unconfigured so the rest of the app works without it.
const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

function fromAddress(): string | undefined {
  return process.env["EMAIL_FROM"] || process.env["SMTP_USER"];
}

export function isEmailConfigured(): boolean {
  return !!(process.env["BREVO_API_KEY"] && fromAddress());
}

export async function sendEmail(opts: { to: string; subject: string; text: string; html?: string }): Promise<boolean> {
  const apiKey = process.env["BREVO_API_KEY"];
  const from = fromAddress();
  if (!apiKey || !from) {
    logger.warn("Email not configured (BREVO_API_KEY / EMAIL_FROM); skipping send");
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: from, name: process.env["EMAIL_FROM_NAME"] || "Golf Pool" },
        to: [{ email: opts.to }],
        subject: opts.subject,
        textContent: opts.text,
        ...(opts.html ? { htmlContent: opts.html } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error({ status: res.status, body: body.slice(0, 300), to: opts.to }, "Brevo send failed");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, to: opts.to }, "Failed to send email");
    return false;
  } finally {
    clearTimeout(timer);
  }
}
