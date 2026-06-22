import { logger } from "./logger";

// Map a tournament name to The-Odds-API golf "winner" market key. Only the four
// majors are covered by the free tier.
const SPORT_KEYS: Array<{ test: RegExp; key: string }> = [
  { test: /masters/i, key: "golf_masters_tournament_winner" },
  { test: /pga\s*champ/i, key: "golf_pga_championship_winner" },
  { test: /(the\s*open|british\s*open|open\s*champ)/i, key: "golf_the_open_championship_winner" },
  { test: /u\.?\s*s\.?\s*open/i, key: "golf_us_open_winner" },
];

export function majorSportKey(tournamentName: string): string | null {
  for (const { test, key } of SPORT_KEYS) {
    if (test.test(tournamentName)) return key;
  }
  return null;
}

export interface OddsEntry {
  name: string;
  odds: number; // American odds (e.g. 450 = +450)
}

const impliedProb = (american: number): number =>
  american >= 0 ? 100 / (american + 100) : -american / (-american + 100);

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

// Fetch winner odds for a major, aggregated across books (union of players,
// median American odds each), ordered most-favored first. null = no key /
// fetch error; [] = no odds posted yet.
export async function fetchMajorOdds(sportKey: string): Promise<OddsEntry[] | null> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return null;
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=us&markets=outrights&oddsFormat=american`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      logger.warn({ status: res.status, sportKey }, "odds API returned non-200");
      return null;
    }
    const data = (await res.json()) as any[];
    if (!Array.isArray(data) || data.length === 0) return [];

    const prices = new Map<string, number[]>();
    for (const bk of data[0].bookmakers ?? []) {
      const market =
        (bk.markets ?? []).find((m: any) => m.key === "outrights") ?? (bk.markets ?? [])[0];
      for (const o of market?.outcomes ?? []) {
        if (typeof o.name !== "string" || typeof o.price !== "number") continue;
        if (!prices.has(o.name)) prices.set(o.name, []);
        prices.get(o.name)!.push(o.price);
      }
    }
    const entries: OddsEntry[] = [...prices.entries()].map(([name, ps]) => ({
      name,
      odds: Math.round(median(ps)),
    }));
    entries.sort((a, b) => impliedProb(b.odds) - impliedProb(a.odds));
    return entries;
  } catch (err) {
    logger.error({ err, sportKey }, "Failed to fetch odds");
    return null;
  }
}

// Normalize a player name for matching across data sources (ESPN field vs odds).
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/[.,'`’-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
