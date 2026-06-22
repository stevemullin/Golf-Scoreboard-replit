import express, { type Express } from "express";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { rateLimit } from "./middlewares/rate-limit";
import { logger } from "./lib/logger";

const app: Express = express();

// Behind Render's proxy — needed so req.ip reflects the real client for rate limiting.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Frontend is served same-origin by this server, so CORS isn't needed.
// Brute-force guard on the password-protected admin endpoints.
app.use("/api/admin", rateLimit({ windowMs: 60_000, max: 30 }));

app.use("/api", router);

// Serve frontend static files in production
// __dirname is set by the esbuild banner to the dist/ directory
const frontendDist = path.resolve(__dirname, "../../golf-pool/dist/public");
if (fs.existsSync(frontendDist)) {
  logger.info({ frontendDist }, "Serving frontend static files");
  app.use(express.static(frontendDist));
  // SPA fallback: serve index.html for all non-API routes
  // Express 5 uses path-to-regexp v8 which requires named wildcards
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

export default app;
