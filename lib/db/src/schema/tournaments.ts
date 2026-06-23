import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tournamentsTable = pgTable("tournaments", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  year: integer("year").notNull(),
  espnEventId: text("espn_event_id"),
  status: text("status").notNull().default("upcoming"),
  currentRound: integer("current_round").notNull().default(0),
  isActive: boolean("is_active").notNull().default(false),
  // Field size for the projected cut (50/60/70). null = cut indicator disabled.
  cutSize: integer("cut_size"),
  // Participant picks freeze at this time; null = not set (no self-service lock).
  picksLockAt: timestamp("picks_lock_at", { withTimezone: true }),
  // Event metadata from ESPN (for the scoreboard header).
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  broadcasts: text("broadcasts"), // comma-joined TV/streaming names
  statusDetail: text("status_detail"), // e.g. "Final", "In Progress - Round 3"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTournamentSchema = createInsertSchema(tournamentsTable).omit({ id: true, createdAt: true });
export type InsertTournament = z.infer<typeof insertTournamentSchema>;
export type Tournament = typeof tournamentsTable.$inferSelect;
