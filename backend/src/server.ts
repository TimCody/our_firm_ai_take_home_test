import express from "express";
import cors from "cors";
import { extractRoute } from "./routes/extract.js";

export function createServer() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      aiFallbackAvailable: Boolean(process.env.ANTHROPIC_API_KEY),
    });
  });

  app.use("/api/extract", extractRoute());

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction,
    ) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      // eslint-disable-next-line no-console
      console.error("[backend] error:", err);
      res.status(500).json({ error: message });
    },
  );

  return app;
}
