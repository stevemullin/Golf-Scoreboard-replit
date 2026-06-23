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
} | { notFound: true } | null> {
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

    // Find the matching event if espnEventId is provided. If a specific event was
    // requested but ESPN's response doesn't include it (e.g. a future event not
    // yet in the current window, or a wrong id), do NOT fall back to the current
    // event — that would stamp another tournament's data onto this one.
    let event;
    if (espnEventId) {
      event = data.events.find((e: { id: string }) => e.id === espnEventId);
      if (!event) {
        logger.warn({ espnEventId }, "ESPN response did not include the requested event; treating as not found");
        return { notFound: true };
      }
    } else {
      event = data.events[0];
    }

    return parseEvent(event);
  } catch (err) {
    logger.error({ err }, "Failed to fetch ESPN scoreboard");
    return null;
  }
}

// Parse a single ESPN event object into golfers + status. Shared by the live
// (?event=) and historical (?dates=) fetch paths so scoring is identical.
function parseEvent(event: any): { golfers: ESPNGolferData[]; eventStatus: ESPNEventStatus } | null {
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

      const hasDisplayValue = Object.prototype.hasOwnProperty.call(linescore, "displayValue")
        && linescore.displayValue != null
        && linescore.displayValue !== "";

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
      const isCut = golferIsCut && holesCompleted === 0 && scoreToPar === null;

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
}

// Historical fetch: ESPN's ?event=<id> falls back to the current event for past
// ids, but ?dates=<year> returns the full season WITH final scores. Find the
// event by name within that year and parse it.
export async function fetchESPNHistoricalEvent(year: number, nameQuery: string): Promise<{
  espnEventId: string;
  name: string;
  golfers: ESPNGolferData[];
  eventStatus: ESPNEventStatus;
} | null> {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=${year}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      logger.warn({ status: response.status, year }, "ESPN historical fetch non-200");
      return null;
    }
    const data = await response.json() as any;
    const events = (data.events || []) as any[];
    const q = nameQuery.toLowerCase();
    const event = events.find((e) => String(e.name || "").toLowerCase().includes(q));
    if (!event) {
      logger.warn({ year, nameQuery }, "No matching historical event found");
      return null;
    }
    const parsed = parseEvent(event);
    if (!parsed) return null;
    return { espnEventId: String(event.id), name: String(event.name), ...parsed };
  } catch (err) {
    logger.error({ err, year, nameQuery }, "Failed to fetch historical ESPN event");
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
