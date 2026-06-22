import { pgTable, text, integer, unique } from "drizzle-orm/pg-core";
import { tournamentsTable } from "./tournaments";
import { golfersTable } from "./golfers";

// Per-tournament tier assignment for a golfer (1-5). Presence of rows for a
// tournament means it uses tiered picks; absence means free-form picks.
export const golferTiersTable = pgTable("golfer_tiers", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tournamentId: text("tournament_id").notNull().references(() => tournamentsTable.id, { onDelete: "cascade" }),
  golferId: text("golfer_id").notNull().references(() => golfersTable.id, { onDelete: "cascade" }),
  tier: integer("tier").notNull(), // 1-5
  odds: integer("odds"), // American odds at tiering time (e.g. 450 = +450); null if unpriced
}, (t) => [
  unique().on(t.tournamentId, t.golferId),
]);

export type GolferTier = typeof golferTiersTable.$inferSelect;
