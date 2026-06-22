import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// APP_DATABASE_URL takes priority over the runtime-managed DATABASE_URL so we
// can point production at a specific Neon endpoint without being blocked by
// Replit's runtime-managed variable restrictions.
const connectionString =
  process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "APP_DATABASE_URL or DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Plain pg Pool. A previous NeonRetryPool subclass overrode connect() as a
// promise-only method, but pg's pool.query() calls connect(callback) internally;
// the ignored callback meant every query hung forever. connectionTimeoutMillis
// gives Neon time to wake from suspension (cold start can take ~20 s); the
// keep-alive ping keeps it warm so that rarely matters.
export const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 30000,
});

// Retry transient connection failures — Neon waking from suspend can throw
// "endpoint has been disabled" or a connect timeout on the first query. We wrap
// only the promise-style query() that drizzle and our routes use; the callback
// style is passed through untouched so we never break pg's internal callback
// contract (that contract violation is the bug the old NeonRetryPool had).
const RETRYABLE = [
  "endpoint has been disabled",
  "Enable it using the API and retry",
  "timeout exceeded when trying to connect",
  "Connection terminated",
  "ECONNREFUSED",
  "ETIMEDOUT",
];
const isRetryable = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return RETRYABLE.some((m) => msg.includes(m));
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rawQuery = pool.query.bind(pool) as (...args: any[]) => any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pool as any).query = (...args: any[]) => {
  if (typeof args[args.length - 1] === "function") return rawQuery(...args); // callback form
  const attempt = async (n: number): Promise<unknown> => {
    try {
      return await rawQuery(...args);
    } catch (err) {
      if (isRetryable(err) && n < 3) {
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** n, 8000)));
        return attempt(n + 1);
      }
      throw err;
    }
  };
  return attempt(0);
};

// Prevent unhandled 'error' events on the pool from crashing the process.
// Individual query errors are already caught in route handlers.
pool.on("error", (err) => {
  console.error("[db] pool error:", err.message);
});
export const db = drizzle(pool, { schema });

export * from "./schema";
