# Document Region Extractor

Upload one or many documents (PDF, DOCX, or image). Get back the **letterhead**, **footer**, and **signature** for each, as downloadable PNGs/JPEGs, with a brief explanation of how each region was found and a confidence score.

> Take-home assessment. Built end-to-end in TypeScript with deterministic-first heuristics and an opt-in Claude vision improvement step for the trickiest signal (signature). Includes a multi-document gallery, sidebar dials for deadline-pressure & HITL-threshold (UI-only sketch), and Vitest coverage on the pure helpers.

---

## Quick start

```bash
git clone <this-repo>
cd our_firm_ai_take_home_test
npm run dev
```

That's it. The `predev` hook runs `npm install` and `npm run fixtures` on first run (only when their markers are missing), then starts both servers with HMR. Subsequent `npm run dev` invocations are instant — the hook is a no-op once dependencies and fixtures exist.

Then open <http://localhost:5173>. The Vite dev server proxies `/api/*` to the backend on `:3001`. Drag any file from `samples/` into the dropzone.

Optional extras:

```bash
# Anthropic key for the "Improve with LLM" button
cp .env.example .env   # then edit and set ANTHROPIC_API_KEY=sk-ant-...

# Regenerate fixtures from scratch
npm run fixtures

# Run the unit tests
npm test
```

### Docker

```bash
docker compose up --build
# backend exposed on :3001 — front it with nginx for static assets
```

The repo also has a `Dockerfile` (multi-stage) for direct image builds.

---

## What's in the box

```
.
├── backend/                  # Express + TypeScript API
│   └── src/
│       ├── server.ts         # routes, CORS, error handler
│       ├── routes/extract.ts
│       ├── lib/              # PURE helpers — no I/O, fully unit-tested
│       │   ├── text-layout.ts     # groupIntoLines, findTopCluster
│       │   ├── ink-density.ts     # row-darkness scans for handwriting
│       │   ├── mime-sniff.ts      # magic-byte content detection
│       │   ├── json-parse.ts      # tolerant JSON extraction from LLM output
│       │   ├── cost-estimator.ts  # Anthropic vision $ estimator
│       │   └── __tests__/         # vitest specs for each
│       └── extractors/        # I/O-wrapped orchestration on top of lib/
│           ├── pdf.ts        # pdfjs-dist + @napi-rs/canvas render pipeline
│           ├── docx.ts       # mammoth-based DOCX fallback
│           ├── image.ts      # PNG/JPEG input handling
│           ├── letterhead.ts
│           ├── footer.ts
│           ├── signature.ts
│           ├── ai-fallback.ts # Claude Haiku 4.5 vision, opt-in only
│           └── __tests__/
├── frontend/                 # Vite + vanilla TypeScript (no framework — see below)
│   └── src/
│       ├── main.ts           # top-level wiring; everything else is a module
│       ├── state.ts          # tiny observable Store + AppState shape
│       ├── api.ts            # fetch helpers (typed)
│       ├── sidebar.ts        # deadline pills + HITL threshold dial
│       ├── gallery.ts        # multi-doc thumb strip + prev/next nav
│       ├── region-card.ts    # one region (letterhead/footer/signature)
│       ├── ai-panel.ts       # "Improve with LLM" + cost preview
│       ├── confidence.ts     # confidence-bar widget
│       ├── preview.ts        # client-side pdf.js preview rendering
│       └── styles.css
├── scripts/
│   └── generate-fixtures.ts  # produces the labelled sample corpus
├── samples/                  # populated by `npm run fixtures`
│   ├── easy/ medium/ hard/   # PDFs
│   ├── images/ docx/
│   └── INDEX.json            # ground-truth labels for every fixture
├── Dockerfile / docker-compose.yml
└── .env.example
```

---

## How extraction works

### PDF (the primary path)

1. **Render with `pdfjs-dist`** (legacy/Node build) into `@napi-rs/canvas`. We only fully rasterize the first and last pages at 2× scale; middle pages get cheap thumbnails. Cross-platform without native compile (`node-canvas` is fragile on Windows).
2. **Extract the text layer** with bounding boxes. Coordinates are flipped from PDF-bottom-left to top-left to match image coordinates.
3. **Region heuristics** run on the rendered page + text layer:

| Region | Strategy | Confidence signals |
|---|---|---|
| Letterhead | Top text cluster of page 1 → crop from y=0 to the deepest item in that cluster, capped at 25% of page height | Centered alignment, large font, presence of URL / phone / address tokens, words like "Inc/LLC/Group" |
| Footer | Top of the bottom-18% band on the last page → crop to page bottom. Returns "not detected" if no text in that band | Copyright marks, page numbers, **cross-page repetition** (same string near bottom on multiple pages → very confident) |
| Signature | Three parallel signals on the last page: (a) sign-off tokens ("Sincerely,", "Regards,", "/s/", …), (b) italic/script fonts in the bottom half, (c) ink-density scan on the raster — runs of dark pixel rows that don't match text alignment. Highest-scoring candidate wins | Token presence > italic font > ink density |

4. **AI improvement (opt-in)** — the deterministic pipeline runs by default and the response includes a precise **cost estimate** for what a Claude vision call on this document would cost. The user clicks "Improve with LLM" in the UI to fire it. We send the full last page (signatures aren't always at the bottom — initialed margins, signed photos, etc.) and ask `claude-haiku-4-5-20251001` for a normalized bbox, which we re-project to pixel coords. Haiku is chosen deliberately: this is a *location* task, not a reasoning task — Sonnet's extra cost buys nothing here. If anything fails (no key, API error, malformed JSON), we keep the deterministic result. The route also accepts `?ai=auto` to fire automatically below a threshold and `?ai=off` to disable; the UI uses `off` initially and `on` for the explicit improve button.

### DOCX

`mammoth` extracts the raw text; we synthesize a US-letter-sized canvas and apply the same top/bottom slice strategy. Embedded image signatures aren't extracted — see [Known limitations](#known-limitations).

### Images (PNG / JPEG)

EXIF-rotated, then sliced into top-18% (letterhead) and bottom-15% (footer). Signature extraction is skipped — without a text layer the ink-density signal alone is too unreliable to ship.

---

## Architectural choices & trade-offs

Each subsection below names the decision, **what we gave up**, and why the trade was worth it.

### Server-side extraction (vs. pure client-side `pdf.js`)
- **Decision:** Run extraction on Express; only use `pdf.js` in the browser for the preview pane.
- **Trade-off:** Server load + hosting cost vs. zero-server browser-only deploy.
- **Why worth it:** AI API keys can't live in the browser; the brief explicitly evaluates "server logic"; large files would otherwise consume client memory. A static-site-only version would dodge two evaluation criteria.

### Deterministic-first, opt-in AI
- **Decision:** Default policy is `ai=off`. The deterministic pipeline runs; the response includes a precise per-document cost estimate; the UI exposes "Improve with LLM" as an explicit button.
- **Trade-off:** One extra user click vs. magical-feeling auto-improvement. Some users will leave Claude unused on docs where it would have helped.
- **Why worth it:** Cost transparency. At scale, auto-fire AI on every upload is the path to a finance review. Surfacing the cost preview teaches users *when* AI is worth firing — which is a better long-term product behavior than hiding the price tag.

### Vanilla TypeScript on the frontend
- **Decision:** No React, Vue, or Svelte. Vite + plain TS + a 60-line observable Store.
- **Trade-off:** No component library; if this app grows to 30 screens we'd be re-inventing routing and component reuse.
- **Why worth it:** The state graph is "upload → fetch → render three images." React's reconciliation is ceremony at that scale. We saved ~140 KB of runtime and an entire mental model. If the app grows past ~5 screens we'd port to a framework; today, it's overengineering.

### `@napi-rs/canvas` over `node-canvas`
- **Decision:** Use the N-API canvas implementation for server-side PDF rasterization.
- **Trade-off:** Smaller community + fewer Stack Overflow answers than `node-canvas`. Slightly less battle-tested.
- **Why worth it:** Pre-built binaries via N-API. `node-canvas` requires Cairo + Pango toolchains that break on fresh Windows installs ~50% of the time. The "Robustness" evaluation criterion rewards *not* making the reviewer fight a native compile.

### `mammoth` for DOCX (vs. LibreOffice headless)
- **Decision:** Use `mammoth` to convert DOCX → HTML and synthesize a page.
- **Trade-off:** No true Word-fidelity rendering. Embedded image signatures aren't extracted; complex layouts (tables, columns) flatten.
- **Why worth it:** LibreOffice would have produced pixel-perfect renders but requires a system dependency that breaks the "single command to start" promise. Documented as a known limitation; primary path is PDF.

### Deployment scenarios as presets, not dials
- **Decision:** Sidebar exposes 4 discrete presets, each bundling deadline + throughput + users + recommended confidence threshold.
- **Trade-off:** Less granular control than a slider; users with edge-case requirements (e.g. 30k docs/day with a tight deadline) don't have an exact-match preset.
- **Why worth it:** Configuration-as-engineering-cop-out. Each preset is an *opinion*: "this is how I'd actually build it at that scale." A slider asks the user to invent values; a preset shows engineering judgment. The architecture diagrams below the gallery make each opinion concrete.

### Pure helpers vs. I/O extractors
- **Decision:** `backend/src/lib/` contains only data-in / data-out functions (no fs, no canvas, no fetch). `backend/src/extractors/` wraps I/O around them.
- **Trade-off:** More files, slightly more import boilerplate.
- **Why worth it:** The library code is unit-testable without mocking. The extractors are thin shells around tested cores. The test suite runs in ~100ms with zero fixtures on disk.

### Workspaces over a single package
- **Decision:** Root `package.json` declares `workspaces: ["frontend", "backend"]`.
- **Trade-off:** Slightly more complex `npm install` resolution; hoisting can surprise you.
- **Why worth it:** Frontend and backend use *different builds* of `pdfjs-dist` (browser ESM vs. Node legacy). Workspaces keep their dependency closures separate but allow one install command at the root.

### Discrete tier of failure surfacing
- **Decision:** `RegionResult.detected: false` returns a structured "not detected" with rationale instead of a 404 or empty payload.
- **Trade-off:** Heavier response payload; the type system has to handle null fields for `imageDataUrl`, `width`, `height`, `page`.
- **Why worth it:** The brief explicitly asks "If you decide a region is not present, the UI should communicate that clearly." A structured null with a *reason* gives the UI both the visual ("not detected" badge) and the explanation ("No text detected in the bottom 18% of the page").

### What I considered and rejected
- **`pdf-parse`** — text-only, no rasterization. Couldn't show previews or do ink-density.
- **Adobe PDF Extract API** — accurate but commercial, and a single proprietary dependency for the whole demo would have been the *only* mechanism (the brief warns against that).
- **`tesseract.js` OCR for scanned PDFs** — listed as a bonus, intentionally deferred. Would slot in as a step before the text-layer extraction when the layer is empty.
- **A framework (React/Vue)** — see above; would have added runtime weight for almost no state graph.
- **A relational DB even in MVP** — DynamoDB matches the serverless DNA of the upgrade path; introducing Postgres early would have made the MVP→Department migration harder.

---

## Deployment scenarios

The sidebar in the app exposes four discrete scenarios. Each is a complete opinion (deadline + users + throughput + confidence threshold + architecture). The architecture sketch for the selected preset renders below the gallery in the UI.

| Scenario | Deadline | Users | Throughput | Confidence | Architecture in one line |
|---|---|---|---|---|---|
| **Take-home demo** | 4-6 hours | 1 (reviewer) | ~10 docs total | 65% | Single Node process + browser, in-memory |
| **Internal MVP** | 1-2 months | 5-20 (one team) | 100-500/day · burst 50/hr | 70% | S3 + CloudFront → API Gateway + WAF + Cognito → single Extract Lambda → S3 + Bedrock (opt-in) + DynamoDB + CloudWatch/Budgets |
| **Department rollout** | 3-6 months | 50-200 multi-team | 5k-15k/day · 200/hr | 80% | S3 + CloudFront → API Gateway + WAF + Cognito → Upload Lambda → SQS work queue → Extract worker pool (Textract first, Bedrock on miss) → Confidence router λ → DynamoDB + SQS HITL queue (in-app reviewer) |
| **Enterprise platform** | 12+ months | 1k+ multi-tenant | 100k+/day · 1k/min | 85% | S3 → EventBridge → dedup → Classifier λ → per-format Step Functions (Textract / mammoth / Tesseract→Textract cascade) → Region-selector λ → Bedrock Claude → Confidence router → DDB + SQS HITL queue (consumed by sibling HITL Review service) → SNS/WebSocket push + DDB Streams to analytics |

**Why discrete presets instead of free dials**: a slider for "threshold" without context is configuration-as-engineering-cop-out. Each preset names the actual operating point (throughput + cost + SLA expectations) and lets the user pick the closest match. The threshold then *follows from* the scenario, rather than the user having to invent it.

---

## Sample corpus

`npm run fixtures` writes 18 PDFs + 2 images + 1 DOCX into `samples/`. Each is labelled with expected regions in `samples/INDEX.json`:

| Tier | Count | Purpose |
|---|---|---|
| `easy` | 10 | Clean business letters with all three regions clearly present — the extractor should nail these |
| `medium` | 6 | Edge cases — missing regions, small fonts, watermarks, low-contrast signatures, multi-page docs |
| `hard` | 2 | Adversarial — poster layout (only a title), jumbled memo with stray "page X of Y" text mid-page |
| `image` | 2 | PNG + JPEG of a synthesized letter, exercises the image path |
| `docx` | 1 | DOCX with native header/footer XML to validate `mammoth` extraction |

A reviewer (or you) can build a regression harness on top of `INDEX.json` to score future changes against ground truth.

---

## API

### `POST /api/extract`

`multipart/form-data` with field `file`.

Query params:
- `ai=off` *(default)* — never call the AI fallback. Deterministic only.
- `ai=on` — force-run the AI vision step.
- `ai=auto` — run it automatically when the deterministic signature confidence is below `SIGNATURE_AI_FALLBACK_THRESHOLD` (0.65).

Response (200):
```jsonc
{
  "documentId": "uuid",
  "fileName": "letter.pdf",
  "mimeType": "application/pdf",
  "pageCount": 1,
  "pagePreviews": ["data:image/png;base64,..."],
  "regions": {
    "letterhead": {
      "kind": "letterhead",
      "detected": true,
      "imageDataUrl": "data:image/png;base64,...",
      "confidence": 0.75,
      "page": 1,
      "rationale": "Top text cluster spans 4 item(s); cropped to y=132 (page height 1100).",
      "width": 1224,
      "height": 132
    },
    "footer":    { /* same shape */ },
    "signature": { /* same shape */ }
  },
  "usedAiFallback": false,
  "aiCostEstimate": {
    "model": "claude-haiku-4-5-20251001",
    "imageTokens": 2585,
    "promptTokens": 200,
    "maxOutputTokens": 256,
    "estimatedUsd": 0.00407,
    "pretty": "~$0.0041"
  },
  "aiAvailable": true,
  "warnings": []
}
```

Error responses (mapped by [`backend/src/lib/error-classifier.ts`](backend/src/lib/error-classifier.ts)):

| Status | When |
|---|---|
| `400` | No file in form data · empty file · unrecognized multer rejection |
| `413` | File exceeds the upload limit (default 25MB) |
| `415` | Unsupported MIME type (sniffed AND declared) |
| `422` | Corrupt / unparseable input (password-protected PDF, corrupt DOCX, corrupt image, malformed PDF) |
| `500` | Genuinely unexpected — logged server-side, generic message returned |

Each 4xx response has a human-readable `error` string the UI surfaces directly to the user (e.g. "Password-protected PDFs are not supported.", "File exceeds the 25MB limit.").

### `GET /api/health`

```json
{ "ok": true, "aiFallbackAvailable": true }
```

---

## Tests

Run with `npm test` (Vitest, ESM, no transpile step).

Tests live next to the code they exercise, in `__tests__/` folders. The coverage targets are deliberately the **silent-failure modes** a new contributor could introduce:

| Helper | What we'd lose if broken |
|---|---|
| `groupIntoLines` | Signatures with descenders would split into two "lines"; the italic-font signal would miss them |
| `findTopCluster` | Letterhead crop would either be empty or include body paragraphs |
| `findDensestDarkRun` | Any text paragraph would be classified as an ink signature |
| `sniffMime` | Mismatched MIME would route DOCX through the PDF path and 500 |
| `extractJsonObject` | Any Claude reply with a preamble would throw and 500 the request |
| `parseVisionResponse` | A response with `present: false` would crash on missing coords |
| `estimateVisionCost` | Cost preview would be wrong, eroding the "transparency" the UI promises |
| `scoreLetterhead` | The confidence number on the letterhead card would drift |
| `SIGN_OFF_TOKENS` | Test iterates the *exported* list — any removed sign-off triggers a failure |
| `classifyError` | A new pdfjs/sharp/mammoth version with renamed errors would silently return 500 instead of helpful 4xx. Tests pin each error class → status mapping. |

The tests are pure-data (no mocking, no fixtures on disk) so they run in ~100ms. Adding more is cheap.

---

## Known limitations

Conscious cuts for the time budget. With more runway:

1. **OCR fallback for scanned PDFs (no text layer)** — the geometric heuristics all assume text positions are available. Plumbing in `tesseract.js` between the rasterizer and the heuristics would close this. Listed as a bonus.
2. **DOCX with embedded image signatures** — the `docx` Open XML format stores signatures as inline `<w:drawing>` elements. Properly extracting them requires walking the XML, not just `mammoth`'s text projection. Stubbed with a clear "not detected" rationale.
3. **Multi-column layouts** — `signature.ts` groups items by y-coordinate only. Two-column documents could spuriously cluster body text into a "sign-off line." A first fix would be to filter candidates by x-overlap with their neighbours.
4. **Per-page footer extraction** — currently we only return the last page's footer. The brief says "or just the last page," so this is acceptable. Easy extension: aggregate the bottom band per page and return an array.
5. **Adjustable crop in the UI** — a bonus item. Today the regions are server-computed and final. With more time I'd add drag-handles on the preview that re-POST to a `/api/recrop` endpoint.
6. **End-to-end regression runner** — the labelled fixture corpus in `samples/INDEX.json` should be consumed by an automated runner that POSTs each fixture and diffs against ground truth. The unit-test layer (`npm test`) is in place; this is the next layer above it.
7. **Rate-limiting on the AI fallback** — a single misbehaving upload could currently fire one Claude call. In production I'd add per-IP rate limiting and a circuit breaker that disables the fallback if error rate exceeds X% in a window.
