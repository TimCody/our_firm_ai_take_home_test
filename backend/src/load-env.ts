/**
 * Side-effect module: load .env from the monorepo root.
 *
 * Why this exists: `import "dotenv/config"` reads from `process.cwd()`.
 * When npm runs `npm:dev --workspace=backend`, the cwd is `backend/`,
 * not the monorepo root where the actual `.env` lives. So the default
 * dotenv path silently misses the file, and `process.env.ANTHROPIC_API_KEY`
 * ends up empty inside the backend process even though the user has
 * it set.
 *
 * This module resolves `.env` relative to its own file location (which
 * is stable between `tsx` and the built JS) and falls back to cwd if
 * that doesn't exist.
 *
 * Must be imported FIRST in the entry file so env vars are available
 * to any other module that reads `process.env` at evaluation time
 * (for example, MAX_UPLOAD_BYTES in routes/extract.ts).
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));

// In dev (tsx) this file sits at backend/src/load-env.ts so the root
// is two levels up. In a built bundle it sits at backend/dist/load-env.js,
// which is also two levels up. We also try cwd as a last resort for
// unusual launch contexts.
const candidates = [
  resolve(here, "../../.env"),
  resolve(process.cwd(), ".env"),
];

for (const path of candidates) {
  if (existsSync(path)) {
    config({ path });
    break;
  }
}
