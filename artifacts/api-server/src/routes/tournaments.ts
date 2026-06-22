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
      createdAt: t.createdAt.toISOString(),
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get tournaments");
    res.status(500).json({ error: "Failed to get tournaments" });
  }
});

export default router;
