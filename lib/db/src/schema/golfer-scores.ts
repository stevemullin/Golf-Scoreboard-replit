import { pgTable, text, integer, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { tournamentsTable } from "./tournaments";
import { golfersTable } from "./golfers";

export const golferScoresTable = pgTable("golfer_scores", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tournamentId: text("tournament_id").notNull().references(() => tournamentsTable.id, { onDelete: "cascade" }),
  golferId: text("golfer_id").notNull().references(() => golfersTable.id, { onDelete: "cascade" }),
  roundNumber: integer("round_number").notNull(),
  scoreToPar: integer("score_to_par"),
  holesCompleted: integer("holes_completed").notNull().default(0),
  isCut: boolean("is_cut").notNull().default(false),
  isWd: boolean("is_wd").notNull().default(false),
  isDq: boolean("is_dq").notNull().default(false),
  teeTime: text("tee_time"),
  holeScores: text("hole_scores"), // JSON: per-hole [{s:strokes,p:toPar}]
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique().on(t.tournamentId, t.golferId, t.roundNumber),
]);

export type GolferScore = typeof golferScoresTable.$inferSelect;
