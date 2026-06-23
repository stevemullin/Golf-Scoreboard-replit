import { logger } from "./logger";

const ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard";

export interface ESPNGolfer {
  espnId: string;
  name: string;
}

export interface ESPNRoundScore {
  roundNumber: number;
  scoreToPar: number | null;
  holesCompleted: number;
  isCut: boolean;
  isWd: boolean;
  isDq: boolean;
  teeTime: string | null;
  holeScores: string | null; // JSON: [{s:strokes,p:toPar}, ...up to 18]
}

export interface ESPNGolferData {
  espnId: string;
  name: string;
  scores: ESPNRoundScore[];
  currentRound: number;
}

export interface ESPNEventStatus {
  state: string; // "pre", "in", "post"
  completed: boolean;
  currentRound: number;
  startDate: string | null;
  endDate: string | null;
  broadcasts: string[];
  statusDetail: string | null; // e.g. "Final", "In Progress - Round 3"
}

function parseScoreValue(displayValue: string): number | null {
  if (!displayValue || displayValue === "-" || displayValue === "") return null;
  if (displayValue === "E") return 0;
  return parseInt(displayValue, 10);
}

export async function fetchESPNScoreboard(espnEventId?: string): Promise<{
  golfers: ESPNGolferData[];
  eventStatus: ESPNEventStatus;
} | null> {
  try {
    const url = espnEventId
      ? `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?event=${espnEventId}`
      : ESPN_SCOREBOARD_URL;

    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      logger.warn({ status: response.status, url }, "ESPN API returned non-200");
      return null;
    }

    const data = await response.json() as any;

    if (!data.events || data.events.length === 0) {
      logger.warn("ESPN API returned no events");
      return null;
    }

    // Find the matching event if espnEventId is provided
    let event = data.events[0];
    if (espnEventId) {
      const found = data.events.find((e: { id: string }) => e.id === espnEventId);
      if (found) event = found;
    }

    const competition = event.competitions?.[0];
    if (!competition) return null;

    // Determine current round from competitors' linescores
    let maxRound = 0;
    for (const comp of (competition.competitors || [])) {
      for (const ls of (comp.linescores || [])) {
        if (ls.period <= 4 && ls.linescores?.some((h: { displayValue: string }) => h.displayValue !== "-" && h.displayValue !== "")) {
          if (ls.period > maxRound) maxRound = ls.period;
        }
      }
    }

    const eventStatus: ESPNEventStatus = {
      state: event.status?.type?.state || "pre",
      completed: event.status?.type?.completed || false,
      currentRound: maxRound,
      startDate: event.date || null,
      endDate: event.endDate || null,
      broadcasts: Array.from(
        new Set(((competition.broadcasts || []) as Array<{ names?: string[] }>).flatMap((b) => b.names || [])),
      ),
      statusDetail: event.status?.type?.shortDetail || event.status?.type?.description || null,
    };

    const golfers: ESPNGolferData[] = [];

    for (const competitor of (competition.competitors || [])) {
      const espnId = competitor.id;
      const name = competitor.athlete?.displayName || competitor.athlete?.fullName || "Unknown";
      const scores: ESPNRoundScore[] = [];

      // Determine cut/out status at the golfer level. Once the field reaches
      // round 3+, ESPN stops advancing cut players, so their highest linescore
      // period stays below the field's current round. A player who simply hasn't
      // teed off in the current round still gets a linescore entry for it, so they
      // are NOT flagged. (The old per-round "empty round > 2 = cut" rule wrongly
      // flagged everyone who hadn't started round 3/4 yet.)
      const golferPeriods = (competitor.linescores || [])
        .map((l: { period: number }) => l.period)
        .filter((p: number) => p >= 1 && p <= 4);
      const golferMaxPeriod = golferPeriods.length ? Math.max(...golferPeriods) : 0;
      const golferIsCut = maxRound >= 3 && golferMaxPeriod < maxRound;

      for (const linescore of (competitor.linescores || [])) {
        const roundNumber = linescore.period;
        if (roundNumber > 4) continue;

        // Critical: check whether displayValue actually EXISTS on the object.
        // - displayValue absent → round simply hasn't started yet (skip this entry)
        // - displayValue = "-" → could be cut (check further) or in-progress placeholder
        // - displayValue = "E" / number → active/finished score
        const hasDisplayValue = Object.prototype.hasOwnProperty.call(linescore, "displayValue")
          && linescore.displayValue != null
          && linescore.displayValue !== "";

        // If there's no displayValue at all, the round hasn't started.
        // Still push a "not started" entry so the DB upsert can clear any
        // stale isCut=true flags left over from a previous (buggy) sync.
        if (!hasDisplayValue) {
          scores.push({ roundNumber, scoreToPar: null, holesCompleted: 0, isCut: golferIsCut, isWd: false, isDq: false, teeTime: null, holeScores: null });
          continue;
        }

        const displayValue = linescore.displayValue as string;
        const holes = linescore.linescores || [];
        const holesCompleted = holes.filter(
          (h: { displayValue: string }) => h.displayValue !== "-" && h.displayValue !== ""
        ).length;
        const holeScores = holes.length
          ? JSON.stringify(
              holes.slice(0, 18).map((h: { displayValue?: string; scoreType?: { displayValue?: string } }) => ({
                s: h.displayValue && h.displayValue !== "-" && h.displayValue !== "" ? h.displayValue : null,
                p: h.scoreType?.displayValue ?? null,
              })),
            )
          : null;

        const scoreToPar = parseScoreValue(displayValue);

        // Cut only if this golfer is out (golferIsCut) AND this specific round
        // has no score — never null out a round they actually played.
        const isCut = golferIsCut && holesCompleted === 0 && scoreToPar === null;

        // Extract tee time
        let teeTime: string | null = null;
        const stats = linescore.statistics?.categories?.[0]?.stats;
        if (stats && stats.length > 0) {
          const lastStat = stats[stats.length - 1];
          if (lastStat?.displayValue && lastStat.displayValue.includes(":")) {
            teeTime = lastStat.displayValue;
          }
        }

        scores.push({
          roundNumber,
          scoreToPar: isCut ? null : scoreToPar,
          holesCompleted,
          isCut,
          isWd: false,
          isDq: false,
          teeTime,
          holeScores,
        });
      }

      golfers.push({ espnId, name, scores, currentRound: maxRound });
    }

    return { golfers, eventStatus };
  } catch (err) {
    logger.error({ err }, "Failed to fetch ESPN scoreboard");
    return null;
  }
}

export async function fetchESPNField(espnEventId: string): Promise<ESPNGolfer[]> {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?event=${espnEventId}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return [];

    const data = await response.json() as any;

    // Find the matching event
    let event = data.events?.[0];
    if (espnEventId) {
      const found = data.events?.find((e: { id: string }) => e.id === espnEventId);
      if (found) event = found;
    }

    if (!event) return [];
    const competition = event.competitions?.[0];
    if (!competition) return [];

    const golfers: ESPNGolfer[] = [];
    for (const competitor of (competition.competitors || [])) {
      golfers.push({
        espnId: competitor.id,
        name: competitor.athlete?.displayName || competitor.athlete?.fullName || "Unknown",
      });
    }

    return golfers;
  } catch (err) {
    logger.error({ err }, "Failed to fetch ESPN field");
    return [];
  }
}

export interface ESPNEventListItem {
  espnEventId: string;
  name: string;
  date: string; // ISO date
  state: string | null; // "pre" | "in" | "post"
}

// Lists the PGA Tour events for a season (id, name, date, state) so the admin
// can pick an event instead of hunting for its ESPN id.
export async function fetchESPNEvents(year: number): Promise<ESPNEventListItem[]> {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=${year}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return [];
    const data = (await response.json()) as any;
    const events = (data.events ?? []) as any[];
    return events
      .map((e) => ({
        espnEventId: String(e.id),
        name: String(e.name ?? ""),
        date: String(e.date ?? ""),
        state: e?.status?.type?.state ?? null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (err) {
    logger.error({ err }, "Failed to fetch ESPN events");
    return [];
  }
}
