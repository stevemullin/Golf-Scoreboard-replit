import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";

// Email is optional: with no SMTP_USER/SMTP_PASS set, sending is a no-op so the
// rest of the app works fine without it. Gmail app-passwords work out of the box
// via service: "gmail" (smtp.gmail.com); set SMTP_USER + SMTP_PASS in Render.
let transporter: Transporter | null = null;

export function isEmailConfigured(): boolean {
  return !!(process.env["SMTP_USER"] && process.env["SMTP_PASS"]);
}

function getTransporter(): Transporter | null {
  if (!isEmailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env["SMTP_USER"], pass: process.env["SMTP_PASS"] },
    });
  }
  return transporter;
}

export async function sendEmail(opts: { to: string; subject: string; text: string; html?: string }): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    logger.warn("Email not configured (SMTP_USER/SMTP_PASS); skipping send");
    return false;
  }
  const from = process.env["SMTP_FROM"] || process.env["SMTP_USER"]!;
  try {
    await t.sendMail({ from, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html });
    return true;
  } catch (err) {
    logger.error({ err, to: opts.to }, "Failed to send email");
    return false;
  }
}
