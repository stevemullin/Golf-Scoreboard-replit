import { Router } from "express";
import { db } from "@workspace/db";
import { tournamentsTable, apiCacheTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { GetTournamentsResponse } from "@workspace/api-zod";

const router = Router();

router.get("/tournaments", async (req, res) => {
  try {
    const tournaments = await db.select().from(tournamentsTable).orderBy(desc(tournamentsTable.year), desc(tournamentsTable.createdAt));

    const result = tournaments.map(t => ({
      id: t.id,
      name: t.name,
      year: t.year,
      espnEventId: t.espnEventId,
      status: t.status,
      currentRound: t.currentRound,
      isActive: t.isActive,
      cutSize: t.cutSize,
      picksLockAt: t.picksLockAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    }));

    // Newest event first. ESPN event ids are incremental, so they sort
    // chronologically; non-ESPN tournaments fall back to year.
    const idNum = (x: string | null) => {
      const n = Number(x);
      return x && !Number.isNaN(n) ? n : null;
    };
    result.sort((a, b) => {
      const ae = idNum(a.espnEventId);
      const be = idNum(b.espnEventId);
      if (ae != null && be != null) return be - ae;
      if (ae != null) return -1;
      if (be != null) return 1;
      return b.year - a.year;
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get tournaments");
    res.status(500).json({ error: "Failed to get tournaments" });
  }
});

export default router;
