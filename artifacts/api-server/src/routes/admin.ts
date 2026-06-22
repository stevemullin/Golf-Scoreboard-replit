import { Router } from "express";
import { db } from "@workspace/db";
import {
  tournamentsTable,
  poolMembersTable,
  golfersTable,
  teamPicksTable,
  apiCacheTable,
  golferScoresTable,
  manualScoresTable,
  golferTiersTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { fetchESPNField, fetchESPNScoreboard, fetchESPNEvents } from "../lib/espn";
import { refreshFromESPN } from "../lib/scoring";
import { majorSportKey, fetchMajorOdds, normalizeName } from "../lib/odds";

const router = Router();

function checkPassword(password: string): boolean {
  const adminPassword = process.env["ADMIN_PASSWORD"];
  if (!adminPassword) {
    // If no password is set, require a non-empty password
    return false;
  }
  return password === adminPassword;
}

// Only 50/60/70 are valid cut sizes; anything else (incl. empty) disables it.
function normalizeCutSize(v: unknown): number | null {
  const n = Number(v);
  return n === 50 || n === 60 || n === 70 ? n : null;
}

// Tiered-pick rule: one golfer from each of T1/T2/T3, plus T4+T5 totaling three
// with at least one each (i.e. a 6th from T4 or T5). All six distinct + tiered.
function validateTieredPicks(
  tierByGolfer: Map<string, number>,
  golferIds: string[],
): { valid: boolean; reason?: string } {
  if (golferIds.length !== 6) return { valid: false, reason: "Need exactly 6 picks" };
  if (new Set(golferIds).size !== 6) return { valid: false, reason: "Duplicate golfer in picks" };
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const id of golferIds) {
    const t = tierByGolfer.get(id);
    if (!t) return { valid: false, reason: "A pick is not assigned to any tier" };
    counts[t] = (counts[t] ?? 0) + 1;
  }
  if (counts[1] !== 1 || counts[2] !== 1 || counts[3] !== 1) {
    return { valid: false, reason: "Need exactly one golfer from each of T1, T2 and T3" };
  }
  if (counts[4]! + counts[5]! !== 3 || counts[4]! < 1 || counts[5]! < 1) {
    return { valid: false, reason: "Need one from T4 and one from T5, plus one extra from T4 or T5" };
  }
  return { valid: true };
}

// POST /admin/verify - Check password without side effects
router.post("/admin/verify", (req, res) => {
  const { password } = req.body;
  if (!checkPassword(password)) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }
  res.json({ ok: true });
});

// POST /admin/tournament - Create tournament
router.post("/admin/tournament", async (req, res) => {
  try {
    const { name, year, espnEventId, refreshIntervalMinutes, cutSize, password } = req.body;

    if (!checkPassword(password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }

    if (!name || !year || !espnEventId) {
      res.status(400).json({ error: "name, year, and espnEventId are required" });
      return;
    }

    // Create tournament
    const tournament = await db.insert(tournamentsTable).values({
      name,
      year,
      espnEventId,
      status: "upcoming",
      currentRound: 0,
      isActive: false,
      cutSize: normalizeCutSize(cutSize),
    }).returning().then(r => r[0]);

    // Create api_cache entry
    await db.insert(apiCacheTable).values({
      tournamentId: tournament.id,
      refreshIntervalMinutes: refreshIntervalMinutes || 5,
    });

    // Fetch field from ESPN to populate golfers
    try {
      const field = await fetchESPNField(espnEventId);
      for (const golfer of field) {
        const existing = await db.select().from(golfersTable).where(eq(golfersTable.espnId, golfer.espnId)).then(r => r[0]);
        if (!existing) {
          await db.insert(golfersTable).values({ espnId: golfer.espnId, name: golfer.name });
        }
      }
    } catch (err) {
      req.log.warn({ err }, "Failed to fetch ESPN field during tournament creation");
    }

    res.status(201).json({
      id: tournament.id,
      name: tournament.name,
      year: tournament.year,
      espnEventId: tournament.espnEventId,
      status: tournament.status,
      currentRound: tournament.currentRound,
      isActive: tournament.isActive,
      createdAt: tournament.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create tournament");
    res.status(500).json({ error: "Failed to create tournament" });
  }
});

// PATCH /admin/tournament/:tournamentId — update ESPN ID and re-fetch field
router.patch("/admin/tournament/:tournamentId", async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { espnEventId, password } = req.body;

    if (!checkPassword(password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }

    if (!espnEventId) {
      res.status(400).json({ error: "espnEventId is required" });
      return;
    }

    const tournament = await db.update(tournamentsTable)
      .set({ espnEventId })
      .where(eq(tournamentsTable.id, tournamentId))
      .returning()
      .then(r => r[0]);

    if (!tournament) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }

    // Re-fetch the field from ESPN with the new ID
    try {
      const field = await fetchESPNField(espnEventId);
      for (const golfer of field) {
        const existing = await db.select().from(golfersTable).where(eq(golfersTable.espnId, golfer.espnId)).then(r => r[0]);
        if (!existing) {
          await db.insert(golfersTable).values({ espnId: golfer.espnId, name: golfer.name });
        }
      }
    } catch (err) {
      req.log.warn({ err }, "Failed to re-fetch ESPN field after ESPN ID update");
    }

    // Reset cache so next scoreboard load triggers a fresh sync
    await db.update(apiCacheTable).set({ lastFetchedAt: null }).where(eq(apiCacheTable.tournamentId, tournamentId));

    res.json({
      id: tournament.id,
      name: tournament.name,
      year: tournament.year,
      espnEventId: tournament.espnEventId,
      status: tournament.status,
      currentRound: tournament.currentRound,
      isActive: tournament.isActive,
      createdAt: tournament.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update tournament");
    res.status(500).json({ error: "Failed to update tournament" });
  }
});

// POST /admin/tournament/:tournamentId/activate
router.post("/admin/tournament/:tournamentId/activate", async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { password } = req.body;

    if (!checkPassword(password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }

    // Deactivate all tournaments
    await db.update(tournamentsTable).set({ isActive: false });

    // Activate the requested one
    const tournament = await db.update(tournamentsTable)
      .set({ isActive: true, status: "active" })
      .where(eq(tournamentsTable.id, tournamentId))
      .returning()
      .then(r => r[0]);

    if (!tournament) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }

    res.json({
      id: tournament.id,
      name: tournament.name,
      year: tournament.year,
      espnEventId: tournament.espnEventId,
      status: tournament.status,
      currentRound: tournament.currentRound,
      isActive: tournament.isActive,
      createdAt: tournament.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to activate tournament");
    res.status(500).json({ error: "Failed to activate tournament" });
  }
});

// POST /admin/pool-member
router.post("/admin/pool-member", async (req, res) => {
  try {
    const { name, password } = req.body;

    if (!checkPassword(password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }

    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const member = await db.insert(poolMembersTable).values({ name }).returning().then(r => r[0]);

    res.status(201).json({
      id: member.id,
      name: member.name,
      createdAt: member.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create pool member");
    res.status(500).json({ error: "Failed to create pool member" });
  }
});

// POST /admin/picks
router.post("/admin/picks", async (req, res) => {
  try {
    const { tournamentId, poolMemberId, golferIds, password } = req.body;

    if (!checkPassword(password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }

    if (!tournamentId || !poolMemberId || !golferIds || !Array.isArray(golferIds)) {
      res.status(400).json({ error: "tournamentId, poolMemberId, and golferIds are required" });
      return;
    }

    if (golferIds.length !== 6) {
      res.status(400).json({ error: "Exactly 6 golfer picks are required" });
      return;
    }

    // If this tournament uses tiers, enforce the tier selection rules.
    const pickTierRows = await db
      .select({ golferId: golferTiersTable.golferId, tier: golferTiersTable.tier })
      .from(golferTiersTable)
      .where(eq(golferTiersTable.tournamentId, tournamentId));
    if (pickTierRows.length > 0) {
      const tierByGolfer = new Map(pickTierRows.map((r) => [r.golferId, r.tier]));
      const v = validateTieredPicks(tierByGolfer, golferIds);
      if (!v.valid) {
        res.status(400).json({ error: v.reason });
        return;
      }
    }

    // Delete existing picks for this member/tournament
    await db.delete(teamPicksTable).where(and(
      eq(teamPicksTable.tournamentId, tournamentId),
      eq(teamPicksTable.poolMemberId, poolMemberId)
    ));

    // Insert new picks
    for (const golferId of golferIds) {
      await db.insert(teamPicksTable).values({
        tournamentId,
        poolMemberId,
        golferId,
      });
    }

    res.json({ success: true, message: "Picks saved successfully" });
  } catch (err) {
    req.log.error({ err }, "Failed to save picks");
    res.status(500).json({ error: "Failed to save picks" });
  }
});

// GET /admin/field?espnEventId=...
router.get("/admin/field", async (req, res) => {
  try {
    const { espnEventId } = req.query;

    if (!espnEventId || typeof espnEventId !== "string") {
      res.status(400).json({ error: "espnEventId is required" });
      return;
    }

    // First check the DB for golfers already associated with a tournament with this espnEventId
    const tourney = await db.select().from(tournamentsTable)
      .where(eq(tournamentsTable.espnEventId, espnEventId))
      .then(r => r[0]);

    if (tourney) {
      // Return golfers from DB
      const picks = await db.select({
        id: golfersTable.id,
        espnId: golfersTable.espnId,
        name: golfersTable.name,
      }).from(golfersTable);

      if (picks.length > 0) {
        res.json(picks.map(g => ({ id: g.id, espnId: g.espnId, name: g.name })));
        return;
      }
    }

    // Fetch from ESPN
    const field = await fetchESPNField(espnEventId);
    if (!field || field.length === 0) {
      res.json([]);
      return;
    }

    // Upsert golfers and return with DB ids
    const result = [];
    for (const golfer of field) {
      const existing = await db.select().from(golfersTable).where(eq(golfersTable.espnId, golfer.espnId)).then(r => r[0]);
      if (existing) {
        result.push({ id: existing.id, espnId: existing.espnId, name: existing.name });
      } else {
        const inserted = await db.insert(golfersTable).values({ espnId: golfer.espnId, name: golfer.name }).returning().then(r => r[0]);
        result.push({ id: inserted.id, espnId: inserted.espnId, name: inserted.name });
      }
    }

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get field");
    res.status(500).json({ error: "Failed to get field" });
  }
});

// POST /admin/refresh
router.post("/admin/refresh", async (req, res) => {
  try {
    const { tournamentId, password } = req.body;

    if (!checkPassword(password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }

    if (!tournamentId) {
      res.status(400).json({ error: "tournamentId is required" });
      return;
    }

    // Force refresh by resetting lastFetchedAt
    await db.update(apiCacheTable)
      .set({ lastFetchedAt: null })
      .where(eq(apiCacheTable.tournamentId, tournamentId));

    await refreshFromESPN(tournamentId);

    const cache = await db.select().from(apiCacheTable)
      .where(eq(apiCacheTable.tournamentId, tournamentId))
      .then(r => r[0]);

    res.json({
      success: true,
      message: "Refresh completed",
      lastUpdated: cache?.lastFetchedAt?.toISOString() || null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to force refresh");
    res.status(500).json({ error: "Failed to force refresh" });
  }
});

// GET /admin/picks/:tournamentId/:poolMemberId
router.get("/admin/picks/:tournamentId/:poolMemberId", async (req, res) => {
  try {
    const { tournamentId, poolMemberId } = req.params;

    const picks = await db.select({
      id: golfersTable.id,
      espnId: golfersTable.espnId,
      name: golfersTable.name,
    })
      .from(teamPicksTable)
      .innerJoin(golfersTable, eq(teamPicksTable.golferId, golfersTable.id))
      .where(and(
        eq(teamPicksTable.tournamentId, tournamentId),
        eq(teamPicksTable.poolMemberId, poolMemberId)
      ));

    res.json(picks.map(g => ({ id: g.id, espnId: g.espnId, name: g.name })));
  } catch (err) {
    req.log.error({ err }, "Failed to get member picks");
    res.status(500).json({ error: "Failed to get member picks" });
  }
});

// POST /admin/tournament/:tournamentId/cut-size - set/clear the cut size (50/60/70)
router.post("/admin/tournament/:tournamentId/cut-size", async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { cutSize, password } = req.body;
    if (!checkPassword(password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }
    const updated = await db
      .update(tournamentsTable)
      .set({ cutSize: normalizeCutSize(cutSize) })
      .where(eq(tournamentsTable.id, tournamentId))
      .returning()
      .then((r) => r[0]);
    if (!updated) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    res.json({ id: updated.id, cutSize: updated.cutSize });
  } catch (err) {
    req.log.error({ err }, "Failed to update cut size");
    res.status(500).json({ error: "Failed to update cut size" });
  }
});

// POST /admin/tiers/suggest - fetch the major's winner odds and match to the field
router.post("/admin/tiers/suggest", async (req, res) => {
  try {
    const { tournamentId, password } = req.body;
    if (!checkPassword(password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }
    const tournament = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId)).then((r) => r[0]);
    if (!tournament) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    if (!tournament.espnEventId) {
      res.status(400).json({ error: "Tournament has no ESPN event id" });
      return;
    }
    const sportKey = majorSportKey(tournament.name);
    if (!sportKey) {
      res.status(400).json({ error: "Auto-odds only supports the 4 majors. Build tiers manually." });
      return;
    }

    const field = await fetchESPNField(tournament.espnEventId);
    const espnIds = field.map((f) => f.espnId);
    const dbGolfers = espnIds.length
      ? await db.select({ id: golfersTable.id, name: golfersTable.name }).from(golfersTable).where(inArray(golfersTable.espnId, espnIds))
      : [];
    const byNorm = new Map<string, { id: string; name: string }>();
    for (const g of dbGolfers) byNorm.set(normalizeName(g.name), g);

    const odds = await fetchMajorOdds(sportKey);
    if (odds === null) {
      res.status(502).json({ error: "Could not fetch odds (check ODDS_API_KEY / quota)" });
      return;
    }

    const lastName = (n: string) => {
      const p = normalizeName(n).split(" ");
      return p[p.length - 1] ?? "";
    };
    const byLast = new Map<string, Array<{ id: string; name: string }>>();
    for (const g of dbGolfers) {
      const k = lastName(g.name);
      if (!byLast.has(k)) byLast.set(k, []);
      byLast.get(k)!.push(g);
    }

    const matched: Array<{ golferId: string; name: string; odds: number }> = [];
    const matchedIds = new Set<string>();
    const take = (g: { id: string; name: string }, odds: number) => {
      if (!matchedIds.has(g.id)) {
        matched.push({ golferId: g.id, name: g.name, odds });
        matchedIds.add(g.id);
      }
    };
    const pending: typeof odds = [];
    for (const o of odds) {
      const g = byNorm.get(normalizeName(o.name));
      if (g) take(g, o.odds);
      else pending.push(o);
    }
    // Fallback: unambiguous last-name match (handles "Alex" vs "Alexander" etc.)
    for (const o of pending) {
      const cand = (byLast.get(lastName(o.name)) ?? []).filter((g) => !matchedIds.has(g.id));
      if (cand.length === 1) take(cand[0]!, o.odds);
    }

    const prob = (a: number) => (a >= 0 ? 100 / (a + 100) : -a / (-a + 100));
    matched.sort((x, y) => prob(y.odds) - prob(x.odds));
    const unmatched = dbGolfers.filter((g) => !matchedIds.has(g.id)).map((g) => ({ golferId: g.id, name: g.name }));

    const suggestedBreaks = matched
      .slice(1)
      .map((m, i) => ({ index: i + 1, drop: prob(matched[i]!.odds) - prob(m.odds) }))
      .sort((a, b) => b.drop - a.drop)
      .slice(0, 4)
      .map((g) => g.index)
      .sort((a, b) => a - b);

    res.json({ sportKey, matched, unmatched, suggestedBreaks });
  } catch (err) {
    req.log.error({ err }, "Failed to suggest tiers");
    res.status(500).json({ error: "Failed to suggest tiers" });
  }
});

// GET /admin/tiers?tournamentId= - current saved tiers (with golfer names)
router.get("/admin/tiers", async (req, res) => {
  try {
    const tournamentId = typeof req.query.tournamentId === "string" ? req.query.tournamentId : "";
    const rows = await db
      .select({ golferId: golferTiersTable.golferId, name: golfersTable.name, tier: golferTiersTable.tier, odds: golferTiersTable.odds })
      .from(golferTiersTable)
      .innerJoin(golfersTable, eq(golferTiersTable.golferId, golfersTable.id))
      .where(eq(golferTiersTable.tournamentId, tournamentId));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to get tiers");
    res.status(500).json({ error: "Failed to get tiers" });
  }
});

// POST /admin/tiers - replace tier assignments for a tournament
router.post("/admin/tiers", async (req, res) => {
  try {
    const { tournamentId, assignments, password } = req.body;
    if (!checkPassword(password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }
    if (!tournamentId || !Array.isArray(assignments)) {
      res.status(400).json({ error: "tournamentId and assignments[] are required" });
      return;
    }
    const valid = assignments.filter(
      (a: { golferId?: unknown; tier?: unknown }) =>
        a && typeof a.golferId === "string" && [1, 2, 3, 4, 5].includes(Number(a.tier)),
    );
    await db.delete(golferTiersTable).where(eq(golferTiersTable.tournamentId, tournamentId));
    if (valid.length) {
      await db.insert(golferTiersTable).values(
        valid.map((a: { golferId: string; tier: unknown; odds?: unknown }) => ({
          tournamentId,
          golferId: a.golferId,
          tier: Number(a.tier),
          odds: typeof a.odds === "number" ? a.odds : null,
        })),
      );
    }
    // Re-validate existing picks against the new tiers (flag, don't break).
    const tierByGolfer = new Map<string, number>(
      valid.map((a: { golferId: string; tier: unknown }) => [a.golferId, Number(a.tier)]),
    );
    const picks = await db
      .select({ poolMemberId: teamPicksTable.poolMemberId, golferId: teamPicksTable.golferId, memberName: poolMembersTable.name })
      .from(teamPicksTable)
      .innerJoin(poolMembersTable, eq(teamPicksTable.poolMemberId, poolMembersTable.id))
      .where(eq(teamPicksTable.tournamentId, tournamentId));
    const byMember = new Map<string, { name: string; ids: string[] }>();
    for (const p of picks) {
      if (!byMember.has(p.poolMemberId)) byMember.set(p.poolMemberId, { name: p.memberName, ids: [] });
      byMember.get(p.poolMemberId)!.ids.push(p.golferId);
    }
    const warnings: string[] = [];
    for (const m of byMember.values()) {
      const v = validateTieredPicks(tierByGolfer, m.ids);
      if (!v.valid) warnings.push(`${m.name}: ${v.reason}`);
    }

    res.json({ saved: valid.length, warnings });
  } catch (err) {
    req.log.error({ err }, "Failed to save tiers");
    res.status(500).json({ error: "Failed to save tiers" });
  }
});

// GET /admin/events?year= - list PGA Tour events (id/name/date/state) to pick from
router.get("/admin/events", async (req, res) => {
  try {
    const yearParam =
      typeof req.query.year === "string" ? parseInt(req.query.year, 10) : NaN;
    const year = Number.isFinite(yearParam) ? yearParam : new Date().getFullYear();
    const events = await fetchESPNEvents(year);
    res.json(events);
  } catch (err) {
    req.log.error({ err }, "Failed to list events");
    res.status(500).json({ error: "Failed to list events" });
  }
});

// POST /admin/export - download a full JSON backup of all data
router.post("/admin/export", async (req, res) => {
  const { password } = req.body;
  if (!checkPassword(password)) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }
  try {
    const [tournaments, poolMembers, golfers, teamPicks, golferScores, manualScores, apiCache] =
      await Promise.all([
        db.select().from(tournamentsTable),
        db.select().from(poolMembersTable),
        db.select().from(golfersTable),
        db.select().from(teamPicksTable),
        db.select().from(golferScoresTable),
        db.select().from(manualScoresTable),
        db.select().from(apiCacheTable),
      ]);
    const dump = {
      exportedAt: new Date().toISOString(),
      tournaments,
      poolMembers,
      golfers,
      teamPicks,
      golferScores,
      manualScores,
      apiCache,
    };
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(dump, null, 2));
  } catch (err) {
    req.log.error({ err }, "Failed to export data");
    res.status(500).json({ error: "Failed to export data" });
  }
});

export default router;
