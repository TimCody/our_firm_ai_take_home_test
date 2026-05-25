/**
 * Deployment scenarios — discrete presets rather than free-form dials.
 *
 * Each one is a *complete* opinion: deadline + user count + throughput +
 * recommended confidence threshold + the architecture we'd actually build.
 *
 * Picking a preset feels less like "configuring" and more like "I am this
 * kind of customer." The architecture diagram for the active preset is
 * rendered below the gallery so a reviewer can see how each one differs.
 */

export type PresetId = "demo" | "mvp" | "department" | "enterprise";

export interface Preset {
  id: PresetId;
  title: string;
  /** One-liner shown on the preset card. */
  summary: string;
  context: {
    deadline: string;
    users: string;
    throughput: string;
    confidenceThreshold: number;
  };
  /** Why this threshold makes sense for this scale. */
  thresholdRationale: string;
  /** ASCII architecture diagram (monospace; rendered in a <pre>). */
  diagram: string;
  /** Bullet notes that explain the diagram. */
  notes: string[];
}

export const PRESETS: Preset[] = [
  {
    id: "demo",
    title: "Take-home demo",
    summary: "4-6h · 1 user · ~10 docs",
    context: {
      deadline: "4-6 hours",
      users: "1 (reviewer)",
      throughput: "~10 documents total",
      confidenceThreshold: 0.65,
    },
    thresholdRationale:
      "0.65 is the standard \"flag-for-review\" threshold for early experiments. Low enough that easy fixtures pass, high enough that low-contrast cases flag.",
    diagram: `
┌────────────┐         ┌────────────────┐         ┌──────────────────┐
│  Browser   │  HTTP   │ Vite :5173     │  proxy  │ Express :3001    │
│ (vanilla   │ ───────►│ (dev server +  │ ───────►│ (single Node     │
│  TS + HMR) │         │  HMR + pdf.js  │         │  process,        │
│            │         │  preview)      │         │  in-memory only) │
└────────────┘         └────────────────┘         └────────┬─────────┘
                                                           │
                                                  ┌────────┴────────┐
                                                  ▼                 ▼
                                            ┌──────────┐     ┌─────────────┐
                                            │ pdfjs +  │     │ Anthropic   │
                                            │ sharp +  │     │ API         │
                                            │ mammoth  │     │ (manual     │
                                            │ (local)  │     │  trigger)   │
                                            └──────────┘     └─────────────┘
`.trim(),
    notes: [
      "Everything in one Node process. No database, no queue, no auth.",
      "PDFs are processed in-memory; nothing persisted between requests.",
      "AI call is opt-in (the user clicks Improve) — no per-doc API spend without intent.",
      "Why this fits: the assessment is a one-day code review. Adding infra here would obscure the engineering signal.",
    ],
  },
  {
    id: "mvp",
    title: "Internal MVP",
    summary: "1-2 months · 5-20 users · ~250 docs/day",
    context: {
      deadline: "1-2 months",
      users: "5-20 (one team)",
      throughput: "100-500 docs/day · burst to 50/hour",
      confidenceThreshold: 0.70,
    },
    thresholdRationale:
      "0.70 raises the bar a touch from the demo — real users will spot misclassifications faster than a reviewer. Still well below the strict 0.85 we'd use at scale, because the population of doc types is still being learned.",
    diagram: `
              ┌───────────────────┐
              │     nginx / ALB   │
              └─────────┬─────────┘
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
       ┌──────────────┐     ┌──────────────┐
       │ Static front │     │ Backend      │
       │   (S3 + CF)  │     │ (1-2 ECS     │
       │              │     │  tasks)      │
       └──────────────┘     └──────┬───────┘
                                   │
              ┌──────────┬─────────┼─────────────┬─────────────┐
              ▼          ▼         ▼             ▼             ▼
        ┌──────────┐ ┌──────┐ ┌─────────┐  ┌──────────┐ ┌──────────┐
        │ Postgres │ │  S3  │ │Anthropic│  │   SSO    │ │  Sentry  │
        │ (docs,   │ │      │ │  API    │  │  (Okta/  │ │ (errors) │
        │ results, │ │      │ │ + $/day │  │  Azure)  │ │          │
        │ users)   │ │      │ │   cap   │  │          │ │          │
        └──────────┘ └──────┘ └─────────┘  └──────────┘ └──────────┘
`.trim(),
    notes: [
      "Synchronous extraction — at 250 docs/day you don't need a queue yet.",
      "Postgres stores doc metadata + extraction history. Original blobs + region crops in S3 with signed URLs.",
      "AI budget cap: hard $10/day ceiling per tenant, with per-user 20/hour rate limit. Stops a single bug from running up a bill.",
      "SSO via Okta/Azure AD — assume the org already has it; no new identity surface to maintain.",
      "Why this fits: the smallest setup that's actually safe to give to real users. Anything less skips auth or persistence.",
    ],
  },
  {
    id: "department",
    title: "Department rollout",
    summary: "3-6 months · 50-200 users · ~5k docs/day",
    context: {
      deadline: "3-6 months",
      users: "50-200 (multi-team)",
      throughput: "5,000-15,000 docs/day · sustained 200/hour",
      confidenceThreshold: 0.80,
    },
    thresholdRationale:
      "0.80 is where you trust auto-approval but keep a HITL queue for the long tail. At this scale, false positives become operational cost (downstream consumers act on bad crops), so the threshold tightens.",
    diagram: `
                  ┌──────────────────┐
                  │   CloudFront     │
                  └────────┬─────────┘
                           │
                  ┌────────▼─────────┐
                  │   API Gateway    │
                  └────────┬─────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
       ┌────────────┐ ┌────────┐ ┌─────────────┐
       │ API pool   │ │ HITL   │ │ Extract     │
       │ (ECS, 4-8  │ │ review │ │ workers     │
       │  tasks)    │ │ UI     │ │ (ECS, 8-16) │
       └──────┬─────┘ └────────┘ └──────┬──────┘
              │                         │
              ▼                         ▼
       ┌──────────┐              ┌─────────────┐
       │   SQS    │ ───── jobs ──►│  OCR sub-   │
       │  queues  │              │  pool       │
       └──────────┘              │  (tesseract │
                                 │   workers)  │
                                 └──────┬──────┘
                                        │
       ┌───────┬──────────────────┬─────┴───────┬────────────┐
       ▼       ▼                  ▼             ▼            ▼
  ┌───────┐ ┌──────┐ ┌────────────────┐ ┌──────────┐ ┌──────────┐
  │ RDS   │ │  S3  │ │ AWS Bedrock    │ │  Redis   │ │ Datadog  │
  │ (PG)  │ │      │ │ (Claude in     │ │ (cache + │ │ (APM +   │
  │       │ │      │ │  VPC)          │ │  rate    │ │  cost    │
  │       │ │      │ │                │ │  limit)  │ │  budget) │
  └───────┘ └──────┘ └────────────────┘ └──────────┘ └──────────┘
`.trim(),
    notes: [
      "Async by default: upload → SQS → worker picks up. Decouples burst spikes from latency.",
      "Separate worker pools for extract vs HITL — load isolation so one team's review surge doesn't slow extraction.",
      "OCR worker subpool handles scanned PDFs (no text layer); the dispatcher routes based on the text-layer empty check.",
      "AWS Bedrock instead of direct Anthropic API: stays inside the VPC for compliance review (HIPAA / financial data).",
      "Redis caches recent extractions (some docs are re-uploaded) and enforces per-user rate limits.",
      "Why this fits: 5k docs/day is the breaking point for sync extraction. Async + worker pools is the next architectural unit.",
    ],
  },
  {
    id: "enterprise",
    title: "Enterprise platform",
    summary: "12+ months · 1k+ users · 100k+ docs/day",
    context: {
      deadline: "12+ months",
      users: "1,000+ (multi-tenant)",
      throughput: "100k+ docs/day · sustained 1k/min",
      confidenceThreshold: 0.85,
    },
    thresholdRationale:
      "0.85 — combined with domain-specific fine-tuned models, we expect 90%+ auto-approval rates. The remaining 10-15% routes to a dedicated HITL platform with SLAs.",
    diagram: `
                          ┌────────────────────────┐
                          │  Multi-region CDN      │
                          └───────────┬────────────┘
                                      │
              ┌───────────────────────┴───────────────────────┐
              ▼                                               ▼
      ┌──────────────┐                                ┌──────────────┐
      │  Region: US  │                                │  Region: EU  │
      │ (same stack  │                                │ (same stack  │
      │  per region) │                                │  per region) │
      └──────┬───────┘                                └──────────────┘
             │
   ┌─────────┼──────────────┬────────────────┬───────────────┐
   ▼         ▼              ▼                ▼               ▼
┌──────┐ ┌────────┐  ┌──────────────┐ ┌──────────────┐ ┌──────────┐
│ API  │ │ GPU    │  │ Domain FT    │ │ HITL         │ │ Audit    │
│ pool │ │ workers│  │ models       │ │ platform     │ │ log      │
│(k8s) │ │ (own   │  │ (per doc-    │ │ (separate    │ │(immutable│
│      │ │  ML    │  │  type;       │ │  product)    │ │  ledger) │
│      │ │ infer) │  │  Bedrock +   │ │              │ │          │
│      │ │        │  │  ours)       │ │              │ │          │
└──┬───┘ └────────┘  └──────┬───────┘ └──────────────┘ └──────────┘
   │                        │
   └───────────┬────────────┘
               ▼
        ┌────────────────┐
        │ Aurora +       │
        │ pgvector +     │
        │ full-text idx  │
        │ (semantic      │
        │  search across │
        │  extracted     │
        │  regions)      │
        └────────────────┘
`.trim(),
    notes: [
      "Domain-specific fine-tuned models replace Claude on known doc types (contracts, leases, NDAs). Claude becomes a fallback for rare/novel templates.",
      "pgvector enables semantic search across extracted regions — \"find every contract where the signature is on page 3.\"",
      "Multi-region for data residency (US + EU); per-tenant region pin. Cross-region replication only for global tenants.",
      "Immutable audit log (append-only, queryable separately) — compliance for SOX, HIPAA, GxP depending on tenant.",
      "Per-tenant cost allocation: every extraction tags its row with tenant + model used; finance can pull usage by tenant for billing.",
      "Why this fits: at this scale, generic AI is too expensive and too slow. Specialization pays for itself. Domain models are 10-20× cheaper per call.",
    ],
  },
];

export const DEFAULT_PRESET_ID: PresetId = "demo";

export function getPreset(id: PresetId): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
}
