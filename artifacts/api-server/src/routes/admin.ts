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
  pickSubmissionsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { fetchESPNField, fetchESPNScoreboard, fetchESPNEvents } from "../lib/espn";
import { refreshFromESPN } from "../lib/scoring";
import { majorSportKey, fetchMajorOdds, normalizeName } from "../lib/odds";
import { validateTieredPicks } from "../lib/tier-rules";
import { sendPickReminders } from "../lib/reminders";

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
    const { name, year, espnEventId, password } = req.body;

    if (!checkPassword(password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }

    const updates: { name?: string; year?: number; espnEventId?: string } = {};
    if (typeof name === "string" && name.trim()) updates.name = name.trim();
    if (year !== undefined && year !== null && !isNaN(Number(year))) updates.year = Number(year);
    if (typeof espnEventId === "string" && espnEventId.trim()) updates.espnEventId = espnEventId.trim();
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }

    const tournament = await db.update(tournamentsTable)
      .set(updates)
      .where(eq(tournamentsTable.id, tournamentId))
      .returning()
      .then(r => r[0]);

    if (!tournament) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }

    // Only when the ESPN ID changed: re-fetch the field + force a fresh sync.
    if (updates.espnEventId) {
      try {
        const field = await fetchESPNField(updates.espnEventId);
        for (const golfer of field) {
          const existing = await db.select().from(golfersTable).where(eq(golfersTable.espnId, golfer.espnId)).then(r => r[0]);
          if (!existing) {
            await db.insert(golfersTable).values({ espnId: golfer.espnId, name: golfer.name });
          }
        }
      } catch (err) {
        req.log.warn({ err }, "Failed to re-fetch ESPN field after ESPN ID update");
      }
      await db.update(apiCacheTable).set({ lastFetchedAt: null }).where(eq(apiCacheTable.tournamentId, tournamentId));
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
    req.log.error({ err }, "Failed to update tournament");
    res.status(500).json({ error: "Failed to update tournament" });
  }
});

// DELETE /admin/tournament/:tournamentId - remove a tournament + all its data
router.delete("/admin/tournament/:tournamentId", async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const password = req.body?.password || req.get("x-admin-password");
    if (!checkPassword(password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }
    const existing = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId)).then(r => r[0]);
    if (!existing) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    // Delete dependent rows first (don't rely on DB-level cascade being present).
    await db.delete(golferTiersTable).where(eq(golferTiersTable.tournamentId, tournamentId));
    await db.delete(pickSubmissionsTable).where(eq(pickSubmissionsTable.tournamentId, tournamentId));
    await db.delete(teamPicksTable).where(eq(teamPicksTable.tournamentId, tournamentId));
    await db.delete(golferScoresTable).where(eq(golferScoresTable.tournamentId, tournamentId));
    await db.delete(manualScoresTable).where(eq(manualScoresTable.tournamentId, tournamentId));
    await db.delete(apiCacheTable).where(eq(apiCacheTable.tournamentId, tournamentId));
    await db.delete(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete tournament");
    res.status(500).json({ error: "Failed to delete tournament" });
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
    const { name, email, password } = req.body;

    if (!checkPassword(password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }

    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const member = await db.insert(poolMembersTable).values({ name, email: email || null }).returning().then(r => r[0]);

    res.status(201).json({
      id: member.id,
      name: member.name,
      email: member.email,
      accessToken: member.accessToken,
      createdAt: member.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create pool member");
    res.status(500).json({ error: "Failed to create pool member" });
  }
});

// PATCH /admin/pool-member/:id - update a member's email (e.g. to backfill)
router.patch("/admin/pool-member/:id", async (req, res) => {
  try {
    const { email, name, password } = req.body;
    if (!checkPassword(password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }
    const updates: { email?: string | null; name?: string } = {};
    if (email !== undefined) updates.email = email || null;
    if (name !== undefined && name) updates.name = name;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }
    const member = await db.update(poolMembersTable).set(updates).where(eq(poolMembersTable.id, req.params.id)).returning().then(r => r[0]);
    if (!member) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    res.json({ id: member.id, name: member.name, email: member.email, accessToken: member.accessToken });
  } catch (err) {
    req.log.error({ err }, "Failed to update pool member");
    res.status(500).json({ error: "Failed to update pool member" });
  }
});

// POST /admin/members - admin roster with tokens + per-tournament submission
// status (POST so the password + tournamentId stay out of the URL/logs).
// Picks are intentionally NOT returned here — fairness masking (#2).
router.post("/admin/members", async (req, res) => {
  try {
    const { password, tournamentId } = req.body;
    if (!checkPassword(password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }
    const members = await db.select().from(poolMembersTable);
    members.sort((a, b) => a.name.localeCompare(b.name));

    let submittedSet = new Set<string>();
    let pickCounts = new Map<string, number>();
    if (tournamentId) {
      const subs = await db.select({ poolMemberId: pickSubmissionsTable.poolMemberId })
        .from(pickSubmissionsTable).where(eq(pickSubmissionsTable.tournamentId, tournamentId));
      submittedSet = new Set(subs.map((s) => s.poolMemberId));
      const picks = await db.select({ poolMemberId: teamPicksTable.poolMemberId })
        .from(teamPicksTable).where(eq(teamPicksTable.tournamentId, tournamentId));
      for (const p of picks) pickCounts.set(p.poolMemberId, (pickCounts.get(p.poolMemberId) ?? 0) + 1);
    }

    res.json(members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      accessToken: m.accessToken,
      submitted: submittedSet.has(m.id),
      pickCount: pickCounts.get(m.id) ?? 0,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list members");
    res.status(500).json({ error: "Failed to list members" });
  }
});

// POST /admin/send-reminders - email non-submitters their pick link now ("Nudge")
router.post("/admin/send-reminders", async (req, res) => {
  try {
    const { password, baseUrl } = req.body;
    if (!checkPassword(password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }
    const result = await sendPickReminders(typeof baseUrl === "string" ? baseUrl : undefined);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to send reminders");
    res.status(500).json({ error: "Failed to send reminders" });
  }
});

// POST /admin/clear-picks - wipe a member's picks + submission for a tournament
router.post("/admin/clear-picks", async (req, res) => {
  try {
    const { password, tournamentId, poolMemberId } = req.body;
    if (!checkPassword(password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }
    if (!tournamentId || !poolMemberId) {
      res.status(400).json({ error: "tournamentId and poolMemberId are required" });
      return;
    }
    await db.delete(teamPicksTable).where(and(
      eq(teamPicksTable.tournamentId, tournamentId),
      eq(teamPicksTable.poolMemberId, poolMemberId),
    ));
    await db.delete(pickSubmissionsTable).where(and(
      eq(pickSubmissionsTable.tournamentId, tournamentId),
      eq(pickSubmissionsTable.poolMemberId, poolMemberId),
    ));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to clear picks");
    res.status(500).json({ error: "Failed to clear picks" });
  }
});

// POST /admin/tournament/:id/lock - set/clear the participant pick deadline
router.post("/admin/tournament/:id/lock", async (req, res) => {
  try {
    const { password, picksLockAt } = req.body;
    if (!checkPassword(password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }
    let value: Date | null = null;
    if (picksLockAt) {
      const d = new Date(picksLockAt);
      if (isNaN(d.getTime())) {
        res.status(400).json({ error: "Invalid date" });
        return;
      }
      value = d;
    }
    const t = await db.update(tournamentsTable).set({ picksLockAt: value }).where(eq(tournamentsTable.id, req.params.id)).returning().then(r => r[0]);
    if (!t) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }
    res.json({ id: t.id, picksLockAt: t.picksLockAt?.toISOString() ?? null });
  } catch (err) {
    req.log.error({ err }, "Failed to set lock time");
    res.status(500).json({ error: "Failed to set lock time" });
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
