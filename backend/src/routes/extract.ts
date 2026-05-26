import express from "express";
import multer from "multer";
import { extractDocument, type AiMode } from "../extractors/index.js";
import { classifyError } from "../lib/error-classifier.js";

const MAX_UPLOAD_BYTES = Number(
  process.env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024,
);

export function extractRoute() {
  const router = express.Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES },
  });

  /**
   * Wrap multer's middleware so that any upload-layer failure (the
   * most common is LIMIT_FILE_SIZE) gets routed through our error
   * classifier and returns a proper 4xx, not a generic 500.
   */
  const uploadOrError: express.RequestHandler = (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        const { status, message } = classifyError(err, MAX_UPLOAD_BYTES);
        res.status(status).json({ error: message });
        return;
      }
      next();
    });
  };

  router.post("/", uploadOrError, async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded under field 'file'." });
        return;
      }

      const { buffer, originalname, mimetype } = req.file;
      const result = await extractDocument(buffer, originalname, mimetype, {
        ai: parseAiMode(req.query.ai),
      });
      res.json(result);
    } catch (err) {
      const { status, message } = classifyError(err, MAX_UPLOAD_BYTES);

      if (status === 500) {
        // Genuinely unexpected. Log it server-side and let the central
        // error handler decide what to do.
        // eslint-disable-next-line no-console
        console.error("[extract] unhandled:", err);
        next(err);
        return;
      }

      res.status(status).json({ error: message });
    }
  });

  return router;
}

function parseAiMode(raw: unknown): AiMode {
  if (raw === "on" || raw === "auto" || raw === "off") return raw;
  return "off";
}
