# Document Region Extractor

Upload one or many documents (PDF, DOCX, or image). Get back the **letterhead**, **footer**, and **signature** for each, as downloadable PNGs/JPEGs, with a brief explanation of how each region was found and a confidence score.

> Take-home assessment. Built end-to-end in TypeScript with deterministic-first heuristics and an opt-in Claude vision improvement step for the trickiest signal (signature). Includes a multi-document gallery, sidebar dials for deadline-pressure & HITL-threshold (UI-only sketch), and Vitest coverage on the pure helpers.

---

## Quick start

```bash
# 1. install
npm install

# 2. (optional) drop your Anthropic key into .env for the AI improvement button
cp .env.example .env
# edit .env, set ANTHROPIC_API_KEY=sk-ant-...

# 3. generate the sample fixtures (20 PDFs + 2 images + 1 docx)
npm run fixtures

# 4. run the dev server (frontend + backend with HMR)
npm run dev

# (optional) run the unit tests
npm test
```

Then open <http://localhost:5173>. The Vite dev server proxies `/api/*` to the backend on `:3001`.

Drag any file from `samples/` into the dropzone to see the extractor in action.

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

## Architectural choices

### "Server-side extraction" (vs. pure client-side `pdf.js`)
The brief lists "UI, server logic, document processing" as evaluation surfaces — and AI API calls (with keys) must live server-side. So extraction runs on Express. The browser still uses `pdf.js` for **preview rendering** — that gives the user instant feedback while the server processes.

### "Deterministic-first, opt-in AI"
Per-upload AI cost is real at scale. The default policy is now `ai=off` — the deterministic pipeline runs, and the response includes a precise per-document **cost estimate** (model, image tokens, prompt tokens, max output, USD upper bound). The UI surfaces that as an "Improve with LLM" panel; clicking it re-runs extraction with `ai=on`. The route also supports `ai=auto` (legacy: auto-fire below a confidence threshold) for batch workflows that don't have a human in the loop.

### "Deployment scenarios as presets, not dials"
The sidebar offers 4 discrete presets — *Take-home demo*, *Internal MVP*, *Department rollout*, *Enterprise platform* — each bundling deadline, user count, throughput, and recommended confidence threshold into one opinionated choice. A configurable slider would have *looked* flexible but forced the user to invent values. Presets show opinionated thinking: "this is how I'd run this at that scale," with the architecture sketched below the gallery for each. The active preset's threshold drives a live "X of N would be flagged" impact line so the choice feels concrete, not abstract.

### "Pure helpers vs. I/O extractors"
Everything in `backend/src/lib/` is data-in / data-out — no fs, no canvas, no fetch. Those are the things we unit-test. `backend/src/extractors/` wraps I/O around them. The split is what makes the test suite cheap (no mocking) and meaningful (the cores can be exercised exhaustively).

### "Vanilla TypeScript on the frontend"
There's no real state graph here — upload → fetch → render three images. React would be ceremony. Vanilla TS + Vite gets you HMR, ESM, and full type-safety without the runtime tax.

### "`@napi-rs/canvas` over `node-canvas`"
Pre-built binaries via N-API. Works on Windows out of the box. `node-canvas` requires Cairo + Pango toolchains that frequently break fresh installs.

### "Workspaces over single package"
Frontend and backend have non-overlapping dependency surfaces (pdfjs-dist appears in both, but the Node legacy build is distinct from the browser build). npm workspaces keep them isolated while still allowing a single `npm install` at the root.

### What I considered and rejected
- **`pdf-parse`** — text-only, no rasterization. Couldn't show previews or do ink-density.
- **LibreOffice for DOCX** — gives true Word fidelity, but requires a system dep that breaks the "one command to start" promise.
- **OCR (`tesseract.js`) for scanned PDFs** — listed as a bonus, intentionally deferred. Would slot in as a step before the text-layer extraction when the layer is empty.
- **Adobe PDF Extract API** — accurate but commercial, and a single proprietary dependency for the whole demo would have been the *only* mechanism (the brief warns against that).

---

## Deployment scenarios

The sidebar in the app exposes four discrete scenarios. Each is a complete opinion (deadline + users + throughput + confidence threshold + architecture). The architecture sketch for the selected preset renders below the gallery in the UI.

| Scenario | Deadline | Users | Throughput | Confidence | Architecture in one line |
|---|---|---|---|---|---|
| **Take-home demo** | 4-6 hours | 1 (reviewer) | ~10 docs total | 65% | Single Node process + browser, in-memory |
| **Internal MVP** | 1-2 months | 5-20 (one team) | 100-500/day · burst 50/hr | 70% | nginx → 1-2 ECS tasks → Postgres + S3 + Anthropic API + SSO |
| **Department rollout** | 3-6 months | 50-200 multi-team | 5k-15k/day · 200/hr | 80% | CloudFront → API Gateway → ECS pools (API / Extract / HITL) → SQS → RDS + S3 + Bedrock |
| **Enterprise platform** | 12+ months | 1k+ multi-tenant | 100k+/day · 1k/min | 85% | Multi-region k8s + GPU workers + fine-tuned domain models + Aurora pgvector + audit log |

**Why discrete presets instead of free dials**: a slider for "threshold" without context is configuration-as-engineering-cop-out. Each preset names the actual operating point (throughput + cost + SLA expectations) and lets the user pick the closest match. The threshold then *follows from* the scenario, rather than the user having to invent it.

---

## Sample corpus

`npm run fixtures` writes 20 PDFs + 2 images + 1 DOCX into `samples/`. Each is labelled with expected regions in `samples/INDEX.json`:

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

Error responses:
- `400` — no file in form data
- `415` — unsupported MIME type
- `422` — corrupt / unparseable input
- `500` — unexpected server error (with `error` message)

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

---

## What I'd ask the reviewer

(per the brief: "knowing when to ask is part of the role")

1. **Per-page or aggregated regions?** I defaulted to letterhead=first-page, footer=last-page, signature=last-page. For multi-page contracts where each page might have its own signature block, that's wrong — but the brief's "or just the last page" suggests this default is acceptable for the assessment.
2. **Should the preset selection actually change extraction?** Today the preset is informational — it influences which docs get flagged in the UI, but doesn't change the extraction pipeline itself. The next step is to wire each preset to its semantics: Demo runs deterministic-only; MVP auto-fires AI below threshold; Department dispatches to a queue + worker pool; Enterprise routes to a fine-tuned model. Each is a small change; the question is which behaviors are in-scope before launch.
3. **Output dimensions** — I return the raw crop. Some downstream uses (signature for e-sign) want normalized 300×100 with transparent background. Easy to add.
4. **AI improvement scope** — today "Improve with LLM" only refines the signature. Letterhead is rarely the weak link, but footer detection on adversarial layouts (see `samples/hard/02-jumbled-layout.pdf`) could also benefit. Worth doing if the per-doc cost budget can absorb it.
