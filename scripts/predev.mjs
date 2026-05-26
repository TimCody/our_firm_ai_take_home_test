/**
 * predev. Runs automatically before `npm run dev` via the npm
 * lifecycle hook.
 *
 * The job is to make `git clone && npm run dev` work end-to-end with
 * no other commands required.
 *
 * Two checks, each cheap to repeat:
 *   1. Is node_modules present? If not, run `npm install`.
 *   2. Are sample fixtures present? If not, run `npm run fixtures`.
 *
 * Both checks are idempotent. Once the artifacts exist this script is
 * a sub-second no-op. Uses only Node stdlib (no imports beyond node:*)
 * so it can run before any dependency is installed.
 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

const INSTALL_MARKER = "node_modules/.package-lock.json";
const FIXTURE_MARKER = "samples/INDEX.json";

function step(label, cmd) {
  console.log(`\n[predev] ${label}`);
  execSync(cmd, { stdio: "inherit" });
}

if (!existsSync(INSTALL_MARKER)) {
  step(
    "node_modules not found. Running npm install (one-time, ~1 min)...",
    "npm install",
  );
}

if (!existsSync(FIXTURE_MARKER)) {
  step("Generating sample fixtures...", "npm run fixtures");
}
