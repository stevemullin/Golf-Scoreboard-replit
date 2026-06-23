import pg from "pg";

// Idempotent schema migrations, run from the build BEFORE the server starts.
// We do column changes here instead of relying on `drizzle-kit push`: in CI,
// push stalls on interactive prompts (e.g. when it wants to add a unique
// constraint to a populated table) and can silently skip the change — which is
// exactly what dropped the cut_size column and 500'd the scoreboard. Every
// statement is IF NOT EXISTS so this is always safe to re-run.
const connectionString =
  process.env.DATABASE_URL || process.env.APP_DATABASE_URL;

const statements = [
  `ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS cut_size integer`,
  `ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS picks_lock_at timestamptz`,
  `ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS start_date timestamptz`,
  `ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS end_date timestamptz`,
  `ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS broadcasts text`,
  `ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS status_detail text`,
  `CREATE TABLE IF NOT EXISTS golfer_tiers (
     id text PRIMARY KEY,
     tournament_id text NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
     golfer_id text NOT NULL REFERENCES golfers(id) ON DELETE CASCADE,
     tier integer NOT NULL,
     odds integer,
     UNIQUE (tournament_id, golfer_id)
   )`,
  // Self-service picks: per-member email + secret access token, plus a
  // submission marker table. Backfill tokens for any existing members.
  `ALTER TABLE pool_members ADD COLUMN IF NOT EXISTS email text`,
  `ALTER TABLE pool_members ADD COLUMN IF NOT EXISTS access_token text`,
  `UPDATE pool_members SET access_token = gen_random_uuid() WHERE access_token IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS pool_members_access_token_key ON pool_members (access_token)`,
  `CREATE TABLE IF NOT EXISTS pick_submissions (
     id text PRIMARY KEY,
     tournament_id text NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
     pool_member_id text NOT NULL REFERENCES pool_members(id) ON DELETE CASCADE,
     submitted_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (tournament_id, pool_member_id)
   )`,
];

async function run() {
  if (!connectionString) {
    console.error("[migrate] DATABASE_URL is not set");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString });
  try {
    for (const sql of statements) {
      await pool.query(sql);
      console.log("[migrate] ok:", sql);
    }
    console.log("[migrate] done");
  } catch (e) {
    console.error("[migrate] failed:", e.message);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

run();
