import { db } from "@workspace/db";
import { tournamentsTable, poolMembersTable, pickSubmissionsTable, golferTiersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendEmail, isEmailConfigured } from "./email";
import { logger } from "./logger";

const FALLBACK_URL = "https://golf-scoreboard-hk3w.onrender.com";

export interface ReminderResult {
  ok: boolean;
  sent: number;
  skippedNoEmail: number;
  alreadySubmitted: number;
  reason?: string;
}

// Emails every member who hasn't submitted picks for the active tournament their
// personal pick link. Only nags while picks are genuinely open (tiers built +
// a deadline set and still in the future) so it can't spam at the wrong time.
export async function sendPickReminders(baseUrl?: string): Promise<ReminderResult> {
  const empty = { sent: 0, skippedNoEmail: 0, alreadySubmitted: 0 };
  if (!isEmailConfigured()) return { ok: false, ...empty, reason: "Email is not configured (set BREVO_API_KEY and EMAIL_FROM in Render)" };

  const tournament = await db.select().from(tournamentsTable).where(eq(tournamentsTable.isActive, true)).then((r) => r[0]);
  if (!tournament) return { ok: false, ...empty, reason: "No active tournament" };

  const tiers = await db.select({ id: golferTiersTable.id }).from(golferTiersTable).where(eq(golferTiersTable.tournamentId, tournament.id)).limit(1);
  if (tiers.length === 0) return { ok: false, ...empty, reason: "Tiers aren't built for this event yet" };

  const lockAt = tournament.picksLockAt;
  if (!lockAt) return { ok: false, ...empty, reason: "No pick deadline set for this event" };
  if (Date.now() >= lockAt.getTime()) return { ok: false, ...empty, reason: "Picks are already locked" };

  const base = (baseUrl || process.env["APP_URL"] || FALLBACK_URL).replace(/\/$/, "");
  const members = await db.select().from(poolMembersTable);
  const subs = await db.select({ poolMemberId: pickSubmissionsTable.poolMemberId })
    .from(pickSubmissionsTable).where(eq(pickSubmissionsTable.tournamentId, tournament.id));
  const submitted = new Set(subs.map((s) => s.poolMemberId));
  const lockStr = lockAt.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " ET";

  let sent = 0;
  let skippedNoEmail = 0;
  let alreadySubmitted = 0;
  for (const m of members) {
    if (submitted.has(m.id)) { alreadySubmitted++; continue; }
    if (!m.email) { skippedNoEmail++; continue; }
    const link = `${base}/me/${m.accessToken}`;
    const subject = `Reminder: make your ${tournament.name} picks`;
    const text = `Hi ${m.name},\n\nYou haven't submitted your picks for ${tournament.name} ${tournament.year} yet. Picks lock ${lockStr}.\n\nMake your picks here:\n${link}\n\nGood luck!`;
    const html =
      `<p>Hi ${m.name},</p>` +
      `<p>You haven't submitted your picks for <b>${tournament.name} ${tournament.year}</b> yet. Picks lock <b>${lockStr}</b>.</p>` +
      `<p><a href="${link}">Make your picks &rarr;</a></p>` +
      `<p>Good luck!</p>`;
    if (await sendEmail({ to: m.email, subject, text, html })) sent++;
  }
  logger.info({ tournament: tournament.name, sent, skippedNoEmail, alreadySubmitted }, "Pick reminders processed");
  return { ok: true, sent, skippedNoEmail, alreadySubmitted };
}
