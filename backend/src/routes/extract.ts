import express from "express";
import multer from "multer";
import { extractDocument, type AiMode } from "../extractors/index.js";

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024);

export function extractRoute() {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES },
  });

  router.post("/", upload.single("file"), async (req, res, next) => {
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
      // Multer errors and our own thrown errors land here. Translate
      // user-facing messages into 4xx where appropriate.
      if (err instanceof Error) {
        const msg = err.message;
        if (msg.startsWith("Unsupported file type")) {
          res.status(415).json({ error: msg });
          return;
        }
        if (msg.includes("Could not determine image dimensions")) {
          res.status(422).json({ error: msg });
          return;
        }
        if (msg.includes("Invalid PDF") || msg.includes("PDF")) {
          // pdfjs throws "InvalidPDFException" — surface as 422.
          if (
            msg.toLowerCase().includes("invalid") ||
            msg.toLowerCase().includes("corrupt")
          ) {
            res.status(422).json({ error: `Could not parse PDF: ${msg}` });
            return;
          }
        }
      }
      next(err);
    }
  });

  return router;
}

function parseAiMode(raw: unknown): AiMode {
  if (raw === "on" || raw === "auto" || raw === "off") return raw;
  return "off";
}
