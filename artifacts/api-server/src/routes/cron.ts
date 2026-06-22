import { Router } from "express";
import { sendPickReminders } from "../lib/reminders";

const router = Router();

// Automated daily reminders. Point a free external scheduler (e.g. cron-job.org)
// at POST /api/cron/reminders with header X-Cron-Secret: <CRON_SECRET>. Gated by
// the CRON_SECRET env var so it can't be triggered publicly.
router.post("/cron/reminders", async (req, res) => {
  const secret = process.env["CRON_SECRET"];
  if (!secret || req.get("x-cron-secret") !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const result = await sendPickReminders();
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Cron reminders failed");
    res.status(500).json({ error: "Failed to send reminders" });
  }
});

export default router;
