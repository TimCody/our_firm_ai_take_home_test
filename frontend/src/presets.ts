/**
 * Deployment scenarios. Discrete presets rather than free-form dials.
 *
 * Each preset is a complete opinion. Deadline, user count, throughput,
 * recommended confidence threshold, and the architecture we'd actually
 * build for that scale.
 *
 * Picking a preset feels less like "configuring" and more like "I am
 * this kind of customer." The architecture diagram for the active
 * preset renders below the gallery so a reviewer can see how each
 * one differs.
 */

export type PresetId = "demo" | "mvp" | "department" | "enterprise";

/**
 * Strip only the BLANK leading and trailing lines from a template
 * literal. This preserves indentation on the first content line.
 *
 * Why we need this: String.prototype.trim() would also eat the leading
 * spaces of a left-padded ASCII box, which detaches the top-left
 * corner from the rest of the box. That bug rendered as a "floating"
 * box-top row above the diagram. Took a beat to track down.
 */
function stripBlankLines(s: string): string {
  return s.replace(/^[ \t]*\n|\n[ \t]*$/g, "");
}

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
    diagram: stripBlankLines(`
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
`),
    notes: [
      "Everything in one Node process. No database, no queue, no auth.",
      "PDFs are processed in-memory; nothing persisted between requests.",
      "AI call is opt-in (the user clicks Improve). No per-doc API spend without intent.",
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
      "0.70 raises the bar a touch from the demo. Real users spot misclassifications faster than a reviewer does. Still well below the 0.85 we'd use at scale, because at 250 docs/day we're still learning what the population of doc types even looks like.",
    diagram: stripBlankLines(`
            ┌──────────────────────┐
            │  Frontend (S3 + CF)  │
            └──────────┬───────────┘
                       │ upload
                       ▼
            ┌──────────────────────┐         ┌────────────┐
            │   API Gateway + WAF  │ ◄─────  │  Cognito   │
            │   (HTTP API)         │         │  + Okta /  │
            └──────────┬───────────┘         │  Azure SSO │
                       ▼                     └────────────┘
            ┌──────────────────────┐
            │   Extract Lambda     │
            │  (single fn handles  │
            │   PDF / DOCX / image │
            │   in-process)        │
            └──────────┬───────────┘
                       │
          ┌────────────┼─────────────┬───────────────┐
          ▼            ▼             ▼               ▼
    ┌──────────┐ ┌──────────┐  ┌──────────┐  ┌──────────────┐
    │   S3     │ │ Bedrock  │  │ DynamoDB │  │ CloudWatch + │
    │ blobs +  │ │  Claude  │  │ results, │  │ AWS Budgets  │
    │  crops   │ │  vision  │  │ user     │  │ ($/day cap;  │
    │ (signed  │ │ (opt-in  │  │ history  │  │ per-user     │
    │  URLs)   │ │  via UI) │  │          │  │ rate limit)  │
    └──────────┘ └──────────┘  └──────────┘  └──────────────┘
`),
    notes: [
      "Single Lambda handles the whole extraction in-process. At 100-500 docs/day (roughly 1 every 5 min on average) a queue is premature. The serverless DNA still matches the Department and Enterprise diagrams, so the migration path is just \"split this Lambda into a queue plus worker pool\" when throughput demands it.",
      "Bedrock is opt-in. Same \"Improve with LLM\" UX as the demo. Predictable spend while users learn what auto-extraction is actually good for at their org.",
      "AWS Budgets enforces a hard $/day ceiling per tenant + per-user rate limit at the API Gateway WAF. A misbehaving client can't run up a bill before someone notices.",
      "Cognito federated to the org's existing SSO (Okta or Azure AD). No new identity surface to operate.",
      "S3 holds both original blobs and region crops; the UI downloads via signed URLs so docs never go through the API.",
      "DynamoDB stores results + user history. Single-tenant for now, but the table is already partitioned by userId so multi-tenancy is a column-add later.",
      "Why this fits: the smallest serverless setup that's safe to give to real users. Same primitives as the larger tiers; the queue, cascade, dedup, and sibling HITL service get bolted on at the Department and Enterprise sizes.",
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
      "0.80 is where auto-approval becomes trusted but the long tail still goes to a reviewer. At 5-15k docs/day, false positives become operational cost (downstream consumers act on bad crops), so the threshold tightens from MVP's 0.70.",
    diagram: stripBlankLines(`
            ┌──────────────────────┐
            │  Frontend (S3 + CF)  │
            └──────────┬───────────┘
                       │ upload
                       ▼
            ┌──────────────────────┐         ┌────────────┐
            │   API Gateway + WAF  │ ◄─────  │  Cognito   │
            └──────────┬───────────┘         │   + SSO    │
                       ▼                     └────────────┘
            ┌──────────────────────┐
            │   Upload Lambda      │
            │ writes blob → S3,    │
            │ enqueues job,        │
            │ stamps tenantId      │
            └──────────┬───────────┘
                       ▼
                ┌─────────────┐
                │ SQS work Q  │
                │ (+ DLQ)     │
                └──────┬──────┘
                       ▼
            ┌──────────────────────┐
            │ Extract worker pool  │
            │ (Lambda concurrency) │
            │ Textract first;      │
            │ Bedrock on miss      │
            └──────────┬───────────┘
                       ▼
            ┌──────────────────────┐         ┌─────────────┐
            │ Confidence router λ  │ ◄─────  │ CloudWatch  │
            │ ≥ 0.80 → DDB         │         │ latency     │
            │ < 0.80 → HITL queue  │         │ $ / tenant  │
            └────┬─────────────┬───┘         │ DLQ depth   │
                 │ < 0.80      │ ≥ 0.80      │ error rate  │
                 ▼             ▼             └─────────────┘
           ┌──────────────┐ ┌──────────┐
           │  SQS HITL Q  │ │ DynamoDB │
           │  + DLQ on 3x │ │ results  │
           │ → in-app     │ │ (tenant- │
           │   review UI  │ │  tagged) │
           └──────────────┘ └──────────┘
`),
    notes: [
      "SQS between API and extraction. Sync starts hurting past ~200/hr; the queue also gives us free retry plus a DLQ for transient failures.",
      "Cost cascade begins: Textract handles forms + tables ($1.50/1k pages, AWS-native); Bedrock Claude vision fires only on misses. At 5-15k docs/day, AI-on-everything dominates the bill and this ordering is what keeps it sane.",
      "Confidence router is its own Lambda. Lets us tune the threshold or change routing logic without touching the extract workers.",
      "HITL queue plus an in-app review UI. At this size a dedicated review pane inside the existing app works fine. The sibling HITL Review *service* (separate product, RBAC, audit) only earns its keep at enterprise scale.",
      "tenantId stamping starts in the Upload Lambda and threads through to DynamoDB rows. Cost Explorer reports per-tenant become possible before someone asks.",
      "CloudWatch metrics include $/tenant and DLQ depth, so finance and on-call have what they need without a separate APM bill.",
      "Why this fits: at 5-15k docs/day the queue + cost cascade are the architectural primitives that can't be skipped. Anything less can't survive the throughput; anything more (dedup, region-selector, sibling HITL) is premature here and ships at Enterprise scale.",
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
      "0.85. Bedrock vision rarely fires (it's gated by the region-selector lambda and the Textract/Tesseract cascade), so when it does we trust the result above 0.85. The remaining ~10-15% routes to a sibling HITL Review service with its own SLAs.",
    diagram: stripBlankLines(`
            ┌──────────────────────┐
            │  S3 landing bucket   │
            │  PDF / DOCX / image  │
            └──────────┬───────────┘
                       │ ObjectCreated
                       ▼
            ┌──────────────────────┐
            │     EventBridge      │
            │ routes by ext + meta │
            └──────────┬───────────┘
                       ▼
            ┌──────────────────────┐
            │  Dedup check (DDB    │
            │  cond. write on      │
            │  sha256 of bytes)    │
            └──────────┬───────────┘
                       ▼
            ┌──────────────────────┐
            │  Classifier Lambda   │
            │ detects type · tags  │
            │ tenantId + traceId   │
            └─┬─────────┬────────┬─┘
              │ PDF     │ DOCX   │ scan
              ▼         ▼        ▼
        ┌──────────┐┌────────┐┌────────────┐
        │ Step Fn: ││Step Fn:││  Step Fn:  │
        │   PDF    ││  DOCX  ││  scan/img  │
        │          ││        ││            │
        │ Textract ││mammoth ││ Tesseract  │
        │  async   ││→ HTML  ││ → Textract │
        │ (forms + ││        ││ (cascade   │
        │  tables) ││        ││  on miss)  │
        └─────┬────┘└───┬────┘└─────┬──────┘
              └─────────┼───────────┘
                        ▼
            ┌──────────────────────┐
            │ Region-selector λ    │
            │ skip regions this    │
            │ doc type won't need  │
            └──────────┬───────────┘
                       ▼
            ┌──────────────────────┐       ┌─────────────┐
            │ Bedrock · Claude     │       │ CloudWatch  │
            │ vision (only the     │ ◄──── │ latency     │
            │ requested regions)   │       │ $ / tenant  │
            └──────────┬───────────┘       │ DLQ depth   │
                       ▼                   │ conf. drift │
            ┌──────────────────────┐ ◄──── │ error rate  │
            │ Confidence router λ  │       └─────────────┘
            │ ≥ 0.85 → auto        │
            │ < 0.85 → HITL queue  │
            └────┬─────────────┬───┘
                 │ < 0.85      │ ≥ 0.85
                 ▼             │
           ┌──────────────┐    │
           │ SQS HITL Q   │    │
           │ DLQ on 3x    │    │
           │ → HITL svc   │    │
           │   (sibling   │    │
           │    system)   │    │
           └──────┬───────┘    │
                  │ approved   │
                  └──────┬─────┘
                         ▼
            ┌──────────────────────┐
            │      DynamoDB        │
            │ regions + S3 keys +  │
            │ tenantId + traceId   │
            └──────┬───────────────┘
                   │
         ┌─────────┴──────────┐
         │                    │ DDB Streams
         ▼                    ▼
   ┌──────────────────┐  ┌──────────────┐
   │ SNS → API GW WS  │  │  Athena /    │
   │ → attorney UI    │  │  Aurora      │
   └──────────────────┘  │  (analytics) │
                         └──────────────┘
`),
    notes: [
      "S3-first ingestion decouples upload throughput from extraction. Multi-GB scans don't time out an API; bursts buffer naturally in S3.",
      "Quality cascade keeps cost economics sane at 100k+ docs/day: Tesseract (free, on-box) → Textract (~$1.50/1k pages, AWS-native) → Bedrock Claude vision (premium, only when needed). For known doc types Textract often wins outright; Bedrock is the long-tail tier.",
      "Region-selector λ between the format pipelines and Bedrock skips Claude calls for regions a given doc type doesn't need (invoices want forms+tables, not signatures). Empirically cuts Bedrock spend 30-50%.",
      "Content-hash dedup (a DynamoDB conditional write on sha256(bytes)) catches both duplicate S3 ObjectCreated events and user re-uploads at the cheapest possible point, before any pipeline runs.",
      "tenantId + traceId are stamped by the Classifier Lambda and threaded through every Bedrock call, DDB write, and SQS message. Cost Explorer and per-tenant cost dashboards become trivial; finance can answer \"which customer is costing us $X this month\" without rebuilding instrumentation.",
      "DynamoDB is the hot store, used for point reads by docId (which is what the UI calls for). DDB Streams fan out to Athena/Aurora for analytics queries like \"every contract Jane Smith signed in Q2\" or confidence drift by doc type. Right tool for each query pattern, instead of forcing one store to do both badly.",
      "HITL Review is a sibling system. It owns the queue worker, the reviewer UI, RBAC, audit trail, and its own SLAs. Naming it here without drawing it keeps this diagram about extraction; the review platform is its own product lifecycle.",
      "CloudWatch metrics include Conf. drift. That alerts when recent docs score lower than historical at the same threshold, which is the signal that your classifier or upstream OCR is silently degrading before users notice.",
      "Multi-region (US + EU) for data residency is a per-tenant routing decision at the S3 bucket layer. The entire stack from S3 onwards pins to one region per tenant. Bedrock model availability varies by region, so the routing layer also picks the closest supported region.",
      "Why this fits: serverless + managed services lets a small platform team operate the whole stack. The cascade keeps cost predictable at 100k+ docs/day, where flat-rate Claude-on-everything is a finance-review red flag.",
    ],
  },
];

export const DEFAULT_PRESET_ID: PresetId = "demo";

export function getPreset(id: PresetId): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
}
