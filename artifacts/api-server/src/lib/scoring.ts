import { db } from "@workspace/db";
import {
  tournamentsTable,
  poolMembersTable,
  golfersTable,
  teamPicksTable,
  golferScoresTable,
  manualScoresTable,
  apiCacheTable,
} from "@workspace/db";
import { eq, and, isNotNull, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { fetchESPNScoreboard } from "./espn";
import { logger } from "./logger";

export interface GolferRoundDetail {
  golferId: string;
  golferName: string;
  scoreToPar: number | null;
  holesCompleted: number;
  isCut: boolean;
  isWd: boolean;
  isDq: boolean;
  isPenalty: boolean;
  teeTime: string | null;
  counted: boolean;
}

export interface RoundScore {
  roundNumber: number;
  score: number | null;
  golferDetails: GolferRoundDetail[];
}

export interface LeaderboardEntry {
  rank: number;
  poolMemberId: string;
  name: string;
  toPar: number | null;
  thru: string;
  today: number | null;
  r1: number | null;
  r2: number | null;
  r3: number | null;
  r4: number | null;
  rounds: RoundScore[];
}

function getMaxScoreForRound(
  allScores: Array<{ golferId: string; roundNumber: number; scoreToPar: number | null; holesCompleted: number; isCut: boolean; isWd: boolean; isDq: boolean }>,
  roundNumber: number
): number | null {
  const scores = allScores
    .filter(s => s.roundNumber === roundNumber && !s.isCut && !s.isWd && !s.isDq && s.scoreToPar !== null)
    .map(s => s.scoreToPar!);

  if (scores.length === 0) return null;
  return Math.max(...scores);
}

function calculateMemberThru(
  rounds: RoundScore[],
  currentRound: number
): string {
  if (currentRound === 0) return "-";

  const currentRoundData = rounds.find(r => r.roundNumber === currentRound);
  if (!currentRoundData) return "-";

  // Only look at counted golfers for thru calculation
  const counted = currentRoundData.golferDetails.filter(g => g.counted);
  if (counted.length === 0) return "-";

  const finished = counted.filter(g => g.holesCompleted === 18 || g.isCut || g.isWd || g.isDq);
  const inProgress = counted.filter(g => g.holesCompleted > 0 && g.holesCompleted < 18 && !g.isCut && !g.isWd && !g.isDq);

  if (finished.length === counted.length) return "F";
  if (inProgress.length === 0 && finished.length === 0) return "-";
  if (inProgress.length > 0) {
    const minHoles = Math.min(...inProgress.map(g => g.holesCompleted));
    return minHoles.toString();
  }
  return "-";
}

export async function refreshFromESPN(tournamentId: string): Promise<void> {
  const tournament = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId)).then(r => r[0]);
  if (!tournament) return;

  // Stamp lastFetchedAt immediately — prevents concurrent background refreshes
  // from all piling up while the first ESPN fetch is in flight.
  await db.update(apiCacheTable)
    .set({ lastFetchedAt: new Date() })
    .where(eq(apiCacheTable.tournamentId, tournamentId));

  const espnData = await fetchESPNScoreboard(tournament.espnEventId ?? undefined);
  if (!espnData) {
    logger.warn({ tournamentId }, "ESPN fetch returned null, serving stale data");
    return;
  }

  const { golfers, eventStatus } = espnData;

  // ── Batch upsert golfers ──────────────────────────────────────────────────
  // One round-trip for all golfers instead of a select+insert/update per golfer.
  const golferValues = golfers.map(g => ({ espnId: g.espnId, name: g.name }));
  if (golferValues.length > 0) {
    await db.insert(golfersTable)
      .values(golferValues)
      .onConflictDoUpdate({
        target: golfersTable.espnId,
        set: { name: sql`excluded.name` },
      });
  }

  // Resolve espnId → internal golferId in one query
  const espnIds = golfers.map(g => g.espnId);
  const dbGolfers = await db.select({ id: golfersTable.id, espnId: golfersTable.espnId })
    .from(golfersTable)
    .where(sql`${golfersTable.espnId} = ANY(${sql.raw(`ARRAY[${espnIds.map(id => `'${id.replace(/'/g, "''")}'`).join(",")}]`)})`)
  const espnToId = new Map(dbGolfers.map(g => [g.espnId, g.id]));

  // ── Batch upsert golfer scores ────────────────────────────────────────────
  const scoreValues: Array<{
    tournamentId: string;
    golferId: string;
    roundNumber: number;
    scoreToPar: number | null;
    holesCompleted: number;
    isCut: boolean;
    isWd: boolean;
    isDq: boolean;
    teeTime: string | null;
  }> = [];

  for (const golferData of golfers) {
    const golferId = espnToId.get(golferData.espnId);
    if (!golferId) continue;
    for (const rs of golferData.scores) {
      scoreValues.push({
        tournamentId,
        golferId,
        roundNumber: rs.roundNumber,
        scoreToPar: rs.scoreToPar,
        holesCompleted: rs.holesCompleted,
        isCut: rs.isCut,
        isWd: rs.isWd,
        isDq: rs.isDq,
        teeTime: rs.teeTime,
      });
    }
  }

  // Upsert all scores in chunks of 100 to stay within parameter limits
  const CHUNK_SIZE = 100;
  for (let i = 0; i < scoreValues.length; i += CHUNK_SIZE) {
    const chunk = scoreValues.slice(i, i + CHUNK_SIZE);
    await db.insert(golferScoresTable)
      .values(chunk)
      .onConflictDoUpdate({
        target: [golferScoresTable.tournamentId, golferScoresTable.golferId, golferScoresTable.roundNumber],
        set: {
          scoreToPar: sql`excluded.score_to_par`,
          holesCompleted: sql`excluded.holes_completed`,
          isCut: sql`excluded.is_cut`,
          isWd: sql`excluded.is_wd`,
          isDq: sql`excluded.is_dq`,
          teeTime: sql`excluded.tee_time`,
        },
      });
  }

  let newStatus = tournament.status;
  if (eventStatus.state === "in") newStatus = "active";
  else if (eventStatus.state === "post" || eventStatus.completed) newStatus = "completed";

  await db.update(tournamentsTable).set({
    currentRound: eventStatus.currentRound || tournament.currentRound,
    status: newStatus,
  }).where(eq(tournamentsTable.id, tournamentId));

  // Final timestamp update to reflect when the full refresh completed
  await db.update(apiCacheTable).set({ lastFetchedAt: new Date() }).where(eq(apiCacheTable.tournamentId, tournamentId));

  logger.info({ tournamentId, golferCount: golfers.length, scoreCount: scoreValues.length }, "ESPN refresh complete");
}

export async function getOrRefreshScoreboard(tournamentId: string): Promise<LeaderboardEntry[]> {
  const cache = await db.select().from(apiCacheTable).where(eq(apiCacheTable.tournamentId, tournamentId)).then(r => r[0]);

  if (cache) {
    const now = new Date();
    const lastFetched = cache.lastFetchedAt;
    const hasStaleData = !!lastFetched;
    const shouldRefresh = !lastFetched ||
      (now.getTime() - lastFetched.getTime()) > cache.refreshIntervalMinutes * 60 * 1000;

    if (shouldRefresh) {
      if (hasStaleData) {
        // Stale-while-revalidate: serve cached DB data immediately, refresh in background
        refreshFromESPN(tournamentId).catch(err =>
          logger.error({ err }, "Background ESPN refresh failed")
        );
      } else {
        // No cached data at all — must fetch synchronously for first load
        try {
          await refreshFromESPN(tournamentId);
        } catch (err) {
          logger.error({ err }, "ESPN refresh failed, serving stale data");
        }
      }
    }
  }

  return calculateScoreboard(tournamentId);
}

export async function calculateScoreboard(tournamentId: string): Promise<LeaderboardEntry[]> {
  const tournament = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId)).then(r => r[0]);
  if (!tournament) return [];

  const currentRound = tournament.currentRound || 1;

  // Fetch all data in parallel — no sequential per-member queries
  const [members, allScores, allPicks] = await Promise.all([
    db.select().from(poolMembersTable).orderBy(poolMembersTable.name),
    db.select({
      golferId: golferScoresTable.golferId,
      roundNumber: golferScoresTable.roundNumber,
      scoreToPar: golferScoresTable.scoreToPar,
      holesCompleted: golferScoresTable.holesCompleted,
      isCut: golferScoresTable.isCut,
      isWd: golferScoresTable.isWd,
      isDq: golferScoresTable.isDq,
      teeTime: golferScoresTable.teeTime,
    }).from(golferScoresTable).where(eq(golferScoresTable.tournamentId, tournamentId)),
    db.select({
      poolMemberId: teamPicksTable.poolMemberId,
      golferId: teamPicksTable.golferId,
      golferName: golfersTable.name,
    })
      .from(teamPicksTable)
      .innerJoin(golfersTable, eq(teamPicksTable.golferId, golfersTable.id))
      .where(eq(teamPicksTable.tournamentId, tournamentId)),
  ]);

  // Max score per round for cut/WD/DQ penalties
  const maxScores: Record<number, number | null> = {};
  for (let r = 1; r <= 4; r++) {
    maxScores[r] = getMaxScoreForRound(allScores, r);
  }

  // Group picks by member for O(1) lookup
  const picksByMember = new Map<string, Array<{ golferId: string; golferName: string }>>();
  for (const pick of allPicks) {
    if (!picksByMember.has(pick.poolMemberId)) picksByMember.set(pick.poolMemberId, []);
    picksByMember.get(pick.poolMemberId)!.push({ golferId: pick.golferId, golferName: pick.golferName });
  }

  const entries: LeaderboardEntry[] = [];

  for (const member of members) {
    const picks = picksByMember.get(member.id) ?? [];

    if (picks.length === 0) {
      entries.push({
        rank: 0,
        poolMemberId: member.id,
        name: member.name,
        toPar: null,
        thru: "-",
        today: null,
        r1: null, r2: null, r3: null, r4: null,
        rounds: [],
      });
      continue;
    }

    // ── Step 1: compute per-golfer per-round scores and tournament total ──────
    interface GolferWithTotal {
      golferId: string;
      golferName: string;
      isCut: boolean;
      isWd: boolean;
      isDq: boolean;
      // Per-round data (always 4 entries)
      roundData: Array<{
        roundNumber: number;
        scoreToPar: number | null;  // displayed score (null = not started)
        effectiveScore: number;     // used in tournament total (0 for not-started)
        isPenalty: boolean;
        holesCompleted: number;
        teeTime: string | null;
      }>;
      tournamentTotal: number;
      counted: boolean;
    }

    const golferList: GolferWithTotal[] = picks.map(pick => {
      // A golfer is genuinely cut/WD/DQ if any of their round rows say so
      const picksScores = allScores.filter(s => s.golferId === pick.golferId);
      const isCut = picksScores.some(s => s.isCut);
      const isWd  = picksScores.some(s => s.isWd);
      const isDq  = picksScores.some(s => s.isDq);

      let tournamentTotal = 0;
      const roundData = [];

      for (let r = 1; r <= 4; r++) {
        const gs = allScores.find(s => s.golferId === pick.golferId && s.roundNumber === r);

        let scoreToPar: number | null = null;
        let effectiveScore = 0;
        let isPenalty = false;

        if (gs) {
          if (gs.scoreToPar !== null) {
            // Has an actual (or partial) score
            scoreToPar = gs.scoreToPar;
            effectiveScore = gs.scoreToPar;
          } else if (gs.isCut || gs.isWd || gs.isDq) {
            // Missed cut / WD / DQ — apply penalty score for this round
            const penalty = maxScores[r] ?? 0;
            scoreToPar = penalty;
            effectiveScore = penalty;
            isPenalty = true;
          } else {
            // Row exists but no score yet (not teed off in this round).
            // Display as "-", count as 0 (even par) toward tournament total.
            scoreToPar = null;
            effectiveScore = 0;
          }

          // Only include rounds up through the current round in the total
          if (r <= currentRound) {
            tournamentTotal += effectiveScore;
          }
        }
        // No row at all = future round not yet in the ESPN data — skip it.

        roundData.push({
          roundNumber: r,
          scoreToPar,
          effectiveScore,
          isPenalty,
          holesCompleted: gs?.holesCompleted ?? 0,
          teeTime: gs?.teeTime ?? null,
        });
      }

      return {
        golferId: pick.golferId,
        golferName: pick.golferName,
        isCut,
        isWd,
        isDq,
        roundData,
        tournamentTotal,
        counted: false,
      };
    });

    // ── Step 2: rank by tournament total, mark best 4 as counted ─────────────
    const sorted = [...golferList].sort((a, b) => a.tournamentTotal - b.tournamentTotal);
    const best4 = sorted.slice(0, Math.min(4, sorted.length));
    const countedIds = new Set(best4.map(g => g.golferId));
    for (const g of golferList) {
      g.counted = countedIds.has(g.golferId);
    }

    // ── Step 3: team score = sum of best-4 tournament totals ─────────────────
    const teamScore = best4.length > 0
      ? best4.reduce((sum, g) => sum + g.tournamentTotal, 0)
      : null;

    // ── Step 4: build round display data ─────────────────────────────────────
    // For each round, golferDetails carries the actual round score + counted flag.
    // The round-level score (r1/r2/…) = sum of counted golfers' round scores
    // (display only — the team total does NOT come from summing r1+r2+r3+r4).
    const rounds: RoundScore[] = [];

    for (let r = 1; r <= 4; r++) {
      const golferDetails: GolferRoundDetail[] = golferList.map(g => {
        const rd = g.roundData[r - 1];
        return {
          golferId: g.golferId,
          golferName: g.golferName,
          scoreToPar: rd.scoreToPar,
          holesCompleted: rd.holesCompleted,
          isCut: g.isCut,
          isWd: g.isWd,
          isDq: g.isDq,
          isPenalty: rd.isPenalty,
          teeTime: rd.teeTime,
          counted: g.counted,
        };
      });

      // Round display score: sum of counted golfers' actual round scores
      const countedGolfers = golferDetails.filter(gd => gd.counted);
      const anyCountedHasData = countedGolfers.some(gd => gd.scoreToPar !== null || gd.isPenalty);
      const roundScore = anyCountedHasData
        ? countedGolfers.reduce((sum, gd) => sum + (gd.scoreToPar ?? 0), 0)
        : null;

      rounds.push({ roundNumber: r, score: roundScore, golferDetails });
    }

    const todayScore = rounds.find(r => r.roundNumber === currentRound)?.score ?? null;
    const thru = calculateMemberThru(rounds, currentRound);

    entries.push({
      rank: 0,
      poolMemberId: member.id,
      name: member.name,
      toPar: teamScore,
      thru,
      today: todayScore,
      r1: rounds[0]?.score ?? null,
      r2: rounds[1]?.score ?? null,
      r3: rounds[2]?.score ?? null,
      r4: rounds[3]?.score ?? null,
      rounds,
    });
  }

  // Sort by toPar ascending, nulls last
  entries.sort((a, b) => {
    if (a.toPar === null && b.toPar === null) return 0;
    if (a.toPar === null) return 1;
    if (b.toPar === null) return -1;
    return a.toPar - b.toPar;
  });

  // Assign ranks with tie handling
  let rank = 1;
  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && entries[i].toPar !== entries[i - 1].toPar) {
      rank = i + 1;
    }
    entries[i].rank = rank;
  }

  return entries;
}

// Projected cut line, configured per tournament via `cutSize` (50/60/70; null =
// disabled). Returns the cut-line to-par score, but ONLY during the R2 window:
// from when R1 is complete (every active golfer through 18) until R2 is complete
// (every active golfer through 36). Outside that window — or when cutSize is
// unset — returns null. The line is the current Nth-place total (R1 + live R2),
// so it moves as R2 plays out.
export async function getProjectedCut(tournamentId: string): Promise<number | null> {
  const tournament = await db
    .select()
    .from(tournamentsTable)
    .where(eq(tournamentsTable.id, tournamentId))
    .then((r) => r[0]);
  if (!tournament || !tournament.cutSize) return null;
  const cutSize = tournament.cutSize;

  const rows = await db
    .select({
      golferId: golferScoresTable.golferId,
      roundNumber: golferScoresTable.roundNumber,
      scoreToPar: golferScoresTable.scoreToPar,
      holesCompleted: golferScoresTable.holesCompleted,
      isWd: golferScoresTable.isWd,
      isDq: golferScoresTable.isDq,
    })
    .from(golferScoresTable)
    .where(eq(golferScoresTable.tournamentId, tournamentId));

  type G = { r1: number | null; r1Holes: number; r2: number | null; r2Holes: number; out: boolean };
  const byGolfer = new Map<string, G>();
  for (const s of rows) {
    let g = byGolfer.get(s.golferId);
    if (!g) {
      g = { r1: null, r1Holes: 0, r2: null, r2Holes: 0, out: false };
      byGolfer.set(s.golferId, g);
    }
    if (s.isWd || s.isDq) g.out = true;
    if (s.roundNumber === 1) { g.r1 = s.scoreToPar; g.r1Holes = s.holesCompleted; }
    if (s.roundNumber === 2) { g.r2 = s.scoreToPar; g.r2Holes = s.holesCompleted; }
  }

  // Window: every active (non-WD/DQ) golfer through 18 in R1, but not yet all through 18 in R2.
  let r1Complete = true;
  let r2Complete = true;
  let activeCount = 0;
  for (const g of byGolfer.values()) {
    if (g.out) continue;
    activeCount++;
    if (g.r1Holes < 18) r1Complete = false;
    if (g.r2Holes < 18) r2Complete = false;
  }
  if (activeCount < cutSize) return null;
  if (!r1Complete || r2Complete) return null;

  // Cut line = the Nth-place current total (R1 + live R2).
  const totals: number[] = [];
  for (const g of byGolfer.values()) {
    if (g.out || g.r1Holes < 18) continue;
    totals.push((g.r1 ?? 0) + (g.r2 ?? 0));
  }
  totals.sort((a, b) => a - b);
  if (totals.length < cutSize) return null;
  return totals[cutSize - 1] ?? null; // everyone with total <= this makes the cut
}
