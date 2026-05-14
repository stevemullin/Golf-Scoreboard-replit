import { Router } from "express";
import { db } from "@workspace/db";
import {
  tournamentsTable,
  poolMembersTable,
  golfersTable,
  teamPicksTable,
  apiCacheTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { fetchESPNField, fetchESPNScoreboard } from "../lib/espn";
import { refreshFromESPN } from "../lib/scoring";

const router = Router();

function checkPassword(password: string): boolean {
  const adminPassword = process.env["ADMIN_PASSWORD"];
  if (!adminPassword) {
    // If no password is set, require a non-empty password
    return false;
  }
  return password === adminPassword;
}

// POST /admin/tournament - Create tournament
router.post("/admin/tournament", async (req, res) => {
  try {
    const { name, year, espnEventId, refreshIntervalMinutes, password } = req.body;

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

export default router;
