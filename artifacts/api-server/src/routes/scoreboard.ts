import { Router } from "express";
import { db } from "@workspace/db";
import {
  tournamentsTable,
  poolMembersTable,
  manualScoresTable,
  apiCacheTable,
  pickSubmissionsTable,
  teamPicksTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getOrRefreshScoreboard, getProjectedCut, refreshFromESPN } from "../lib/scoring";

const router = Router();

router.get("/scoreboard", async (req, res) => {
  try {
    const activeTournament = await db.select().from(tournamentsTable)
      .where(eq(tournamentsTable.isActive, true))
      .then(r => r[0]);

    if (!activeTournament) {
      res.status(404).json({ error: "No active tournament" });
      return;
    }

    const cache = await db.select().from(apiCacheTable)
      .where(eq(apiCacheTable.tournamentId, activeTournament.id))
      .then(r => r[0]);

    const leaderboard = await getOrRefreshScoreboard(activeTournament.id);
    const projectedCut = await getProjectedCut(activeTournament.id);

    // Refresh cache record for lastUpdated/nextUpdate
    const freshCache = await db.select().from(apiCacheTable)
      .where(eq(apiCacheTable.tournamentId, activeTournament.id))
      .then(r => r[0]);

    // Re-fetch tournament status after potential update
    const tournament = await db.select().from(tournamentsTable)
      .where(eq(tournamentsTable.id, activeTournament.id))
      .then(r => r[0]);

    const lastFetched = freshCache?.lastFetchedAt;
    const intervalMinutes = freshCache?.refreshIntervalMinutes || 5;
    const nextUpdate = lastFetched
      ? new Date(lastFetched.getTime() + intervalMinutes * 60 * 1000).toISOString()
      : null;

    // Picks are hidden until the event starts (round 1) or the pick deadline
    // passes — fairness, so nobody can study others' teams in advance. Until
    // then we send only a masked roster (who has submitted), never the golfers.
    const lockAt = tournament!.picksLockAt;
    // The admin-set lock is the source of truth for when picks reveal. Without a
    // lock, fall back to "revealed once the event is underway" so traditional
    // admin-managed tournaments still show picks.
    const picksRevealed = lockAt
      ? Date.now() >= lockAt.getTime()
      : (tournament!.currentRound ?? 0) >= 1 || tournament!.status === "completed";

    const members = await db.select().from(poolMembersTable).orderBy(poolMembersTable.name);
    const subs = await db.select({ poolMemberId: pickSubmissionsTable.poolMemberId })
      .from(pickSubmissionsTable).where(eq(pickSubmissionsTable.tournamentId, tournament!.id));
    const submittedSet = new Set(subs.map((s) => s.poolMemberId));
    const pickRows = await db.select({ poolMemberId: teamPicksTable.poolMemberId })
      .from(teamPicksTable).where(eq(teamPicksTable.tournamentId, tournament!.id));
    const pickCounts = new Map<string, number>();
    for (const p of pickRows) pickCounts.set(p.poolMemberId, (pickCounts.get(p.poolMemberId) ?? 0) + 1);
    const roster = members.map((m) => ({
      poolMemberId: m.id,
      name: m.name,
      submitted: submittedSet.has(m.id),
      pickCount: pickCounts.get(m.id) ?? 0,
    }));

    res.json({
      tournament: {
        id: tournament!.id,
        name: tournament!.name,
        year: tournament!.year,
        espnEventId: tournament!.espnEventId,
        status: tournament!.status,
        currentRound: tournament!.currentRound,
        isActive: tournament!.isActive,
        cutSize: tournament!.cutSize,
        picksLockAt: lockAt?.toISOString() ?? null,
        createdAt: tournament!.createdAt.toISOString(),
      },
      lastUpdated: lastFetched?.toISOString() || null,
      nextUpdate,
      refreshIntervalMinutes: intervalMinutes,
      projectedCut,
      picksRevealed,
      roster,
      leaderboard: picksRevealed ? leaderboard : [],
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get scoreboard");
    res.status(500).json({ error: "Failed to get scoreboard" });
  }
});

router.get("/scoreboard/manual", async (req, res) => {
  try {
    const activeTournament = await db.select().from(tournamentsTable)
      .where(eq(tournamentsTable.isActive, true))
      .then(r => r[0]);

    if (!activeTournament) {
      res.status(404).json({ error: "No active tournament" });
      return;
    }

    const members = await db.select().from(poolMembersTable).orderBy(poolMembersTable.name);
    const manualScores = await db.select().from(manualScoresTable)
      .where(eq(manualScoresTable.tournamentId, activeTournament.id));

    const leaderboard = members.map(member => {
      const ms = manualScores.find(s => s.poolMemberId === member.id);
      const r1 = ms?.r1 ?? null;
      const r2 = ms?.r2 ?? null;
      const r3 = ms?.r3 ?? null;
      const r4 = ms?.r4 ?? null;
      const scores = [r1, r2, r3, r4].filter(s => s !== null) as number[];
      const toPar = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) : null;

      return {
        id: ms?.id || "",
        tournamentId: activeTournament.id,
        poolMemberId: member.id,
        poolMemberName: member.name,
        r1,
        r2,
        r3,
        r4,
        toPar,
        updatedBy: ms?.updatedBy || null,
        updatedAt: ms?.updatedAt?.toISOString() || null,
      };
    });

    // Sort by toPar ascending, nulls last
    leaderboard.sort((a, b) => {
      if (a.toPar === null && b.toPar === null) return 0;
      if (a.toPar === null) return 1;
      if (b.toPar === null) return -1;
      return a.toPar - b.toPar;
    });

    res.json({
      tournament: {
        id: activeTournament.id,
        name: activeTournament.name,
        year: activeTournament.year,
        espnEventId: activeTournament.espnEventId,
        status: activeTournament.status,
        currentRound: activeTournament.currentRound,
        isActive: activeTournament.isActive,
        createdAt: activeTournament.createdAt.toISOString(),
      },
      leaderboard,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get manual scoreboard");
    res.status(500).json({ error: "Failed to get manual scoreboard" });
  }
});

router.put("/scoreboard/manual", async (req, res) => {
  try {
    const { tournamentId, poolMemberId, r1, r2, r3, r4, updatedBy } = req.body;

    if (!tournamentId || !poolMemberId) {
      res.status(400).json({ error: "tournamentId and poolMemberId are required" });
      return;
    }

    // Ensure tournament and pool member exist
    const tournament = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId)).then(r => r[0]);
    if (!tournament) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }

    const member = await db.select().from(poolMembersTable).where(eq(poolMembersTable.id, poolMemberId)).then(r => r[0]);
    if (!member) {
      res.status(404).json({ error: "Pool member not found" });
      return;
    }

    const existing = await db.select().from(manualScoresTable)
      .where(and(
        eq(manualScoresTable.tournamentId, tournamentId),
        eq(manualScoresTable.poolMemberId, poolMemberId)
      )).then(r => r[0]);

    const scoreData = {
      tournamentId,
      poolMemberId,
      r1: r1 ?? null,
      r2: r2 ?? null,
      r3: r3 ?? null,
      r4: r4 ?? null,
      updatedBy: updatedBy || null,
    };

    let saved;
    if (existing) {
      saved = await db.update(manualScoresTable).set(scoreData).where(eq(manualScoresTable.id, existing.id)).returning().then(r => r[0]);
    } else {
      saved = await db.insert(manualScoresTable).values(scoreData).returning().then(r => r[0]);
    }

    const scores = [saved.r1, saved.r2, saved.r3, saved.r4].filter(s => s !== null) as number[];
    const toPar = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) : null;

    res.json({
      id: saved.id,
      tournamentId: saved.tournamentId,
      poolMemberId: saved.poolMemberId,
      poolMemberName: member.name,
      r1: saved.r1,
      r2: saved.r2,
      r3: saved.r3,
      r4: saved.r4,
      toPar,
      updatedBy: saved.updatedBy,
      updatedAt: saved.updatedAt?.toISOString() || null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update manual score");
    res.status(500).json({ error: "Failed to update manual score" });
  }
});

export default router;
