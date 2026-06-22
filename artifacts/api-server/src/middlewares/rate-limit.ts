import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Minimal dependency-free fixed-window rate limiter. Keyed by client IP, kept
 * in memory — fine for a single free-tier instance. Used to blunt brute-force
 * attempts against the password-protected /admin endpoints.
 */
export function rateLimit(opts: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();

  // Periodically drop expired buckets so the map can't grow unbounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) {
      if (now > b.resetAt) buckets.delete(key);
    }
  }, opts.windowMs);
  // Don't keep the process alive just for the sweep timer.
  (sweep as { unref?: () => void }).unref?.();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    // Key on the real client IP. Behind Render's proxy, req.ip can resolve to a
    // varying intermediate proxy address (depending on trust-proxy hops), which
    // would scatter requests across buckets and defeat the limit. The leftmost
    // X-Forwarded-For entry is the original client, so prefer it.
    const xff = req.headers["x-forwarded-for"];
    const key =
      (typeof xff === "string" && xff.trim() ? xff.split(",")[0]!.trim() : "") ||
      req.ip ||
      req.socket.remoteAddress ||
      "unknown";

    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;

    if (bucket.count > opts.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: "Too many requests. Please slow down." });
      return;
    }

    next();
  };
}
