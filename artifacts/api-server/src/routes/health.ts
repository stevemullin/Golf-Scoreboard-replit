import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// DB-touching health check. A keep-alive pinger hitting this every few minutes
// keeps BOTH the web service (Render) and the database (Neon) warm, so the
// first page load of a tournament session doesn't pay a cold-start penalty.
router.get("/healthz/db", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json(HealthCheckResponse.parse({ status: "ok" }));
  } catch {
    res.status(503).json(HealthCheckResponse.parse({ status: "error" }));
  }
});

export default router;
