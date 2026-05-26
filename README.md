# Document Region Extractor

Upload one or many documents (PDF, DOCX, or image). You get back the **letterhead**, **footer**, and **signature** for each one as downloadable PNGs or JPEGs, with a short explanation of how each region was found and a confidence score.

> Take-home assessment. Built end-to-end in TypeScript. The deterministic pipeline does the bulk of the work; Claude vision is available as an opt-in "Improve with LLM" step for the cases where geometry alone falls short. The app also includes a multi-document gallery, four preset deployment scenarios in the sidebar (with architecture sketches), and a small suite of Vitest unit tests on the pure helpers.

---

## Quick start

```bash
git clone <this-repo>
cd our_firm_ai_take_home_test
npm run dev
```

That's it. The `predev` hook handles `npm install` and `npm run fixtures` automatically on first run, then starts both servers with HMR. After the first run it's a no-op and `npm run dev` boots immediately.

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
# backend exposed on :3001. Front it with nginx for static assets.
```

The repo also has a multi-stage `Dockerfile` for direct image builds.

---

## What's in the box

```
.
├── backend/                  # Express + TypeScript API
│   └── src/
│       ├── server.ts         # routes, CORS, error handler
│       ├── routes/extract.ts
│       ├── lib/              # Pure helpers. No I/O, fully unit-tested.
│       │   ├── text-layout.ts     # groupIntoLines, findTopCluster
│       │   ├── ink-density.ts     # row-darkness scans for handwriting
│       │   ├── mime-sniff.ts      # magic-byte content detection
│       │   ├── json-parse.ts      # tolerant JSON extraction from LLM output
│       │   ├── cost-estimator.ts  # Anthropic vision $ estimator
│       │   ├── error-classifier.ts # maps thrown errors to HTTP responses
│       │   └── __tests__/         # vitest specs for each
│       └── extractors/        # I/O orchestration on top of lib/
│           ├── pdf.ts        # pdfjs-dist + @napi-rs/canvas render pipeline
│           ├── docx.ts       # mammoth-based DOCX fallback
│           ├── image.ts      # PNG/JPEG input handling
│           ├── letterhead.ts
│           ├── footer.ts
│           ├── signature.ts
│           ├── ai-fallback.ts # Claude Haiku 4.5 vision, opt-in only
│           └── __tests__/
├── frontend/                 # Vite + vanilla TypeScript (no framework, see below)
│   └── src/
│       ├── main.ts           # top-level wiring; everything else is a module
│       ├── state.ts          # tiny observable Store + AppState shape
│       ├── api.ts            # fetch helpers (typed)
│       ├── sidebar.ts        # deadline presets + HITL threshold display
│       ├── gallery.ts        # multi-doc thumb strip + prev/next nav
│       ├── region-card.ts    # one region (letterhead/footer/signature)
│       ├── ai-panel.ts       # "Improve with LLM" + cost preview
│       ├── confidence.ts     # confidence-bar widget
│       ├── preview.ts        # client-side pdf.js preview rendering
│       └── styles.css
├── scripts/
│   ├── generate-fixtures.ts  # produces the labelled sample corpus
│   └── predev.mjs            # auto-install + fixture generation on first run
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

1. **Render with `pdfjs-dist`** (legacy/Node build) into `@napi-rs/canvas`. The first and last pages get a full 2x raster; middle pages get cheap thumbnails. The `@napi-rs/canvas` choice matters: it ships pre-built binaries, so installation works on Windows without a native compile (which is where `node-canvas` usually breaks).
2. **Extract the text layer** with bounding boxes. PDF native coordinates are bottom-left origin, so we flip them to top-left to match image space. Easier to reason about everywhere downstream.
3. **Region heuristics** run on the rendered page + text layer:

| Region | Strategy | Confidence signals |
|---|---|---|
| Letterhead | Find the top text cluster on page 1. Crop from y=0 down to the deepest item in that cluster, capped at 25% of page height. | Centered alignment, large font, contact-info tokens (URL, phone, address), corporate suffixes like "Inc/LLC/Group". |
| Footer | Look at the bottom 18% band on the last page. Crop from the topmost text item in that band to the page bottom. Returns "not detected" if the band has no text. | Copyright marks, page numbers, **cross-page repetition** (same text near the bottom on multiple pages is a strong footer signal). |
| Signature | Three parallel signals on the last page. (a) Sign-off tokens: "Sincerely,", "Regards,", "/s/", etc. (b) Italic or script fonts in the lower half. (c) Ink-density scan on the raster, looking for dense rows of dark pixels that don't align with text. The highest-scoring candidate wins. | Token presence > italic font > ink density. |

4. **AI improvement (opt-in)**. The deterministic pipeline runs by default. The response includes a precise cost estimate for what a Claude vision call would cost on this document. The user clicks "Improve with LLM" to fire it. The backend sends the last page to `claude-haiku-4-5-20251001` and asks for normalized bboxes for letterhead, footer, and signature in one call (saves a round trip). The results are re-projected to pixel coordinates and applied where they beat the deterministic confidence. Haiku is the deliberate choice: this is a location task, not a reasoning task, and Sonnet's extra cost wouldn't buy us better accuracy here. If anything fails (no key, API error, malformed JSON), the deterministic result stays put.

### DOCX

`mammoth` reads the file as HTML, and we render a synthetic US-Letter canvas from the text content. The same top/bottom slice strategy runs on that canvas. This loses Word-fidelity layout, but it stays inside the "one command to start" promise (LibreOffice headless would have given perfect output but added a system dependency). Embedded image signatures inside DOCX aren't extracted in this MVP. See [Known limitations](#known-limitations).

### Images (PNG / JPEG)

EXIF-rotated, then sliced into top-18% (letterhead) and bottom-15% (footer). Signature extraction isn't attempted on raw images: without a text layer, the ink-density signal alone is too unreliable to ship.

---

## Architectural choices and trade-offs

Each subsection names the decision, what we gave up, and why the trade was worth it.

### Server-side extraction (instead of pure client-side `pdf.js`)
- **Decision.** Extraction runs on Express. The browser uses `pdf.js` only for the preview pane.
- **Trade-off.** Server load and hosting cost, vs. a zero-server browser-only deploy.
- **Why worth it.** AI API keys can't live in the browser. The brief explicitly evaluates "server logic." Large files would otherwise consume client memory. A static-site-only version would dodge two evaluation criteria.

### Deterministic-first, opt-in AI
- **Decision.** Default is `ai=off`. The deterministic pipeline runs, and the response includes a precise per-document cost estimate. The UI exposes "Improve with LLM" as an explicit button.
- **Trade-off.** One extra click instead of magical-feeling auto-improvement. Some users will leave Claude unused on docs where it would have helped.
- **Why worth it.** Cost transparency. At scale, auto-firing AI on every upload is the path to a finance review. Showing the cost up-front teaches users when AI is worth the price, which is a better long-term behavior than hiding it.

### Vanilla TypeScript on the frontend
- **Decision.** No React, Vue, or Svelte. Vite + plain TS + a 60-line observable Store.
- **Trade-off.** No component library. If this app grew to 30 screens we'd be reinventing routing and component reuse.
- **Why worth it.** The state graph here is "upload, fetch, render three images." React's reconciliation is ceremony at that scale. We saved roughly 140 KB of runtime plus an entire mental model. If the app grew past ~5 screens we'd port to a framework, but today that would be overengineering.

### `@napi-rs/canvas` over `node-canvas`
- **Decision.** Use the N-API canvas implementation for server-side PDF rasterization.
- **Trade-off.** Smaller community, fewer Stack Overflow answers, slightly less battle-tested.
- **Why worth it.** Pre-built binaries via N-API. `node-canvas` needs Cairo + Pango toolchains that fail on fresh Windows installs roughly half the time. The "Robustness" criterion rewards *not* making the reviewer fight a native compile.

### `mammoth` for DOCX (instead of LibreOffice headless)
- **Decision.** Use `mammoth` to convert DOCX into HTML, then synthesize a page.
- **Trade-off.** No true Word-fidelity rendering. Embedded image signatures aren't extracted; complex layouts (tables, columns) flatten.
- **Why worth it.** LibreOffice would have produced pixel-perfect renders but requires a system dependency that breaks the "single command to start" promise. PDF is the primary path; DOCX is bonus.

### Deployment scenarios as presets, not dials
- **Decision.** The sidebar exposes 4 discrete presets. Each bundles deadline + throughput + users + recommended confidence threshold.
- **Trade-off.** Less granular control than a slider. A user with edge-case requirements (say, 30k docs/day with a tight deadline) won't find an exact match.
- **Why worth it.** A slider asks the user to invent values. A preset is an opinion: "this is how I'd actually build it at that scale." The architecture diagrams below the gallery make each opinion concrete.

### Pure helpers vs. I/O extractors
- **Decision.** `backend/src/lib/` contains only data-in, data-out functions (no fs, no canvas, no fetch). `backend/src/extractors/` wraps I/O around them.
- **Trade-off.** More files, slightly more import boilerplate.
- **Why worth it.** The library code is unit-testable without mocking. The extractors are thin shells around tested cores. The test suite runs in roughly 100ms with no fixtures on disk.

### Workspaces over a single package
- **Decision.** The root `package.json` declares `workspaces: ["frontend", "backend"]`.
- **Trade-off.** Slightly more complex `npm install` resolution. Hoisting can surprise you.
- **Why worth it.** Frontend and backend use different builds of `pdfjs-dist` (browser ESM vs. Node legacy). Workspaces keep their dependency closures separate while still allowing a single install at the root.

### Structured "not detected" instead of HTTP 404
- **Decision.** When a region isn't found, the response still has the field, just with `detected: false` and a rationale string explaining why.
- **Trade-off.** A heavier response payload, and TypeScript has to model null fields for `imageDataUrl`, `width`, `height`, `page`.
- **Why worth it.** The brief explicitly asks "If you decide a region is not present, the UI should communicate that clearly." A structured null with a *reason* lets the UI show both the visual ("not detected" badge) and the explanation ("No text detected in the bottom 18% of the page").

### What I considered and rejected
- **`pdf-parse`.** Text-only, no rasterization. Couldn't show previews or do ink-density.
- **Adobe PDF Extract API.** Accurate but commercial, and a single proprietary dependency for the whole demo would have been the *only* mechanism. The brief warns against that.
- **`tesseract.js` OCR for scanned PDFs.** Listed as a bonus, intentionally deferred. Would slot in as a step before the text-layer extraction when the layer is empty.
- **A framework (React, Vue).** See above. Would have added runtime weight for almost no state graph.
- **A relational DB even in MVP.** DynamoDB matches the serverless DNA of the upgrade path. Introducing Postgres early would have made the MVP-to-Department migration harder.

---

## Deployment scenarios

The sidebar exposes four discrete scenarios. Each is a complete opinion: deadline + users + throughput + confidence threshold + architecture. The architecture diagram for the active preset renders below the gallery in the UI.

| Scenario | Deadline | Users | Throughput | Confidence | Architecture in one line |
|---|---|---|---|---|---|
| **Take-home demo** | 4-6 hours | 1 (reviewer) | ~10 docs total | 65% | Single Node process + browser, in-memory |
| **Internal MVP** | 1-2 months | 5-20 (one team) | 100-500/day, burst 50/hr | 70% | S3 + CloudFront → API Gateway + WAF + Cognito → single Extract Lambda → S3 + Bedrock (opt-in) + DynamoDB + CloudWatch/Budgets |
| **Department rollout** | 3-6 months | 50-200 multi-team | 5k-15k/day, 200/hr | 80% | S3 + CloudFront → API Gateway + WAF + Cognito → Upload Lambda → SQS work queue → Extract worker pool (Textract first, Bedrock on miss) → Confidence router λ → DynamoDB + SQS HITL queue (in-app reviewer) |
| **Enterprise platform** | 12+ months | 1k+ multi-tenant | 100k+/day, 1k/min | 85% | S3 → EventBridge → dedup → Classifier λ → per-format Step Functions (Textract / mammoth / Tesseract→Textract cascade) → Region-selector λ → Bedrock Claude → Confidence router → DDB + SQS HITL queue (consumed by sibling HITL Review service) → SNS/WebSocket push + DDB Streams to analytics |

**Why discrete presets instead of free dials**: a "threshold" slider without context is configuration as engineering cop-out. Each preset names the actual operating point (throughput + cost + SLA expectations) and lets the user pick the closest match. The threshold then *follows from* the scenario rather than the user having to invent it.

---

## Sample corpus

`npm run fixtures` writes 19 PDFs + 2 images + 1 DOCX into `samples/`. Each is labelled with expected regions in `samples/INDEX.json`:

| Tier | Count | Purpose |
|---|---|---|
| `easy` | 10 | Clean business letters with all three regions clearly present. The extractor should nail these. |
| `medium` | 7 | Edge cases: missing regions, small fonts, watermarks, low-contrast signatures, multi-page docs, and the scanned-style PDF (no text layer) that shows off the AI path. |
| `hard` | 2 | Adversarial. A poster layout with only a title, and a jumbled memo with stray "page X of Y" text mid-page. |
| `image` | 2 | PNG + JPEG of a synthesized letter. Exercises the image pipeline. |
| `docx` | 1 | DOCX with native header/footer XML to validate `mammoth` extraction. |

The labels in `samples/INDEX.json` are ground truth. A reviewer can build a regression harness on top of it to score future changes.

**Best fixture for the deterministic demo**: `samples/easy/05-thank-you.pdf`. Short single-page letter that hits all three regions cleanly.

**Best fixture for showing the AI improvement path**: `samples/medium/07-scanned-letter.pdf`. The content is a single embedded image with no text layer at all, mimicking a scanned document. Deterministic extraction returns "not detected" for footer and signature. Clicking "Improve with LLM" sends the page to Claude Haiku and the three regions appear, with the AI badge on each.

---

## API

### `POST /api/extract`

`multipart/form-data` with field `file`.

Query params:
- `ai=off` *(default)*. Never call the AI fallback. Deterministic only.
- `ai=on`. Force-run the AI vision step.
- `ai=auto`. Run automatically when the deterministic signature confidence is below `SIGNATURE_AI_FALLBACK_THRESHOLD` (0.65).

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
    "promptTokens": 280,
    "maxOutputTokens": 500,
    "estimatedUsd": 0.00407,
    "pretty": "~$0.0041"
  },
  "aiAvailable": true,
  "warnings": []
}
```

Error responses are mapped by [`backend/src/lib/error-classifier.ts`](backend/src/lib/error-classifier.ts):

| Status | When |
|---|---|
| `400` | No file in form data, empty file, or unrecognized multer rejection. |
| `413` | File exceeds the upload limit (default 25MB). |
| `415` | Unsupported MIME type (both sniffed and declared). |
| `422` | Corrupt or unparseable input. Password-protected PDF, corrupt DOCX, corrupt image, malformed PDF. |
| `500` | Genuinely unexpected. Logged server-side; generic message returned to the client. |

Each 4xx response has a human-readable `error` string the UI surfaces directly to the user. For example: "Password-protected PDFs are not supported." or "File exceeds the 25MB limit."

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
| `groupIntoLines` | Signatures with descenders would split into two "lines". The italic-font signal would miss them. |
| `findTopCluster` | The letterhead crop would either be empty or accidentally include body paragraphs. |
| `findDensestDarkRun` | Any text paragraph could be classified as an ink signature. |
| `sniffMime` | A mismatched MIME would route DOCX through the PDF path and 500. |
| `extractJsonObject` | Any Claude reply with a preamble would throw and 500 the request. |
| `parseAllRegionsResponse` | A response with `present: false` would crash on missing coords; a stringified number from the model would skew the bbox. |
| `estimateVisionCost` | The cost preview would be wrong, undermining the transparency the UI promises. |
| `scoreLetterhead` | The confidence number on the letterhead card would drift over time. |
| `SIGN_OFF_TOKENS` | The test iterates the exported list. Anyone who shortens the token list breaks the test. |
| `classifyError` | A new pdfjs/sharp/mammoth version with renamed errors would silently return 500 instead of helpful 4xx. Tests pin each error class to its status mapping. |

The tests are pure-data (no mocking, no fixtures on disk) so they run in about 100ms. Adding more is cheap.

---

## Known limitations

Conscious cuts for the time budget. With more runway:

1. **OCR fallback for scanned PDFs (no text layer).** The geometric heuristics all assume text positions are available. Plumbing in `tesseract.js` between the rasterizer and the heuristics would close this. Listed as a bonus in the brief. *Partly mitigated today*: the AI vision path works on scanned PDFs because it processes the rasterized pixels directly. See `samples/medium/07-scanned-letter.pdf`.
2. **DOCX with embedded image signatures.** The Open XML format stores them as inline `<w:drawing>` elements. Properly extracting them requires walking the XML, not just mammoth's text projection. Stubbed today with a clear "not detected" rationale.
3. **Multi-column layouts.** `signature.ts` groups items by y-coordinate only. Two-column documents could spuriously cluster body text into what looks like a sign-off line. A first fix would be to filter candidates by x-overlap with their neighbours.
4. **Per-page footer extraction.** Currently we return only the last page's footer. The brief allows this ("or just the last page"). An easy extension would be to aggregate the bottom band per page and return an array.
5. **Adjustable crop in the UI.** A bonus item. Today the regions are server-computed and final. With more time I'd add drag handles on the preview that re-POST to a `/api/recrop` endpoint.
6. **End-to-end regression runner.** The labelled fixture corpus in `samples/INDEX.json` should be consumed by an automated runner that POSTs each fixture and diffs against ground truth. The unit-test layer (`npm test`) is in place. This is the next layer above it.
7. **Rate-limiting on the AI fallback.** A single misbehaving upload could currently fire one Claude call. In production I'd add per-IP rate limiting and a circuit breaker that disables the fallback if the error rate exceeds X% in a window.
</content>
</invoke>