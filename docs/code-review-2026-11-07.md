# Repository review — 7 November 2026

Scope: checked the four exported workflows, Apps Script intake adapter, configure script, README, offline tests and CI files. Existing README statements about prior live Google/Gemini tests were **not independently re-executed** in this review. No account credentials, real client data or paid model calls were used.

## Assessment

This is a coherent integration pilot: human approval remains separate from model output; deterministic calculations distinguish missing evidence from zero progress; workflow outputs use Sheets RAW cell mode; exports omit credentials and start inactive/preview-only. The 55 offline workflow checks and release assertions pass on Node 22. These are useful implementation signals, with a narrower scope than full n8n/Google integration testing.

## Findings and actions

| Priority | Evidence | Risk / concrete next step |
| --- | --- | --- |
| P1 — fixed here | `apps-script/Code.gs`, `appendByHeader_` passed user strings directly to `Sheet.appendRow` | Leading `=` is interpreted as a formula. Escape formula-like text at this write boundary; added regression checks preserving numeric zero, booleans and ordinary text. This does not rewrite existing rows or the Forms-managed response tabs. Verify those tabs' behavior/access separately. |
| P1 — fixed here | No `.github/workflows/` existed at the reviewed base commit | Regression tests were manual only. Added a read-only, no-secret CI workflow running `npm test` on push and PR. |
| P1 — open | WF01/02/03/04 lookup existing IDs, then append | Two overlapping runs can both observe absence. Apps Script's `LockService` protects its own submission handler only, not n8n's reads/writes. Introduce durable unique keys and test parallel executions; do not claim exactly-once behavior. |
| P1 — open | WF01 private Drive HTTP download has no retry; Gemini requests have `retryOnFail: true`, three tries | A transient download failure can stop processing; after exhausted model retries no explicit operator queue is provided. Add safe failure records keyed by submission ID, bounded status-aware retries, and a manual retry action that preserves coach edits. Test 401/403/429/503 separately. |
| P1 — open | Code nodes parse JSON and perform targeted text checks | A JSON-shaped model response can still contain wrong types, unsupported claims or injected instructions. Add complete runtime schema validation and a small adversarial synthetic evaluation set, with failure routed to review. |
| P1 — open | Schedules use local runtime availability and current-day eligibility | Missed windows have no durable catch-up. Add a last-success checkpoint and bounded backfill; test restart spanning a report window. |
| P1 — open | Existing IDs skip report writes | Later coach corrections are not reflected in an existing summary. Add explicit report revisions keyed to source versions, keeping approved text immutable. |
| P2 — open | Whole-sheet reads in recurring workflows | API quota/latency grows with history. Measure rows read, latency and cost; then introduce indexed/partitioned storage or incremental reads. |
| P2 — open | Offline tests mock n8n Code inputs and Apps Script services | Add disposable real n8n import/execution tests and a separately authorized Google OAuth smoke test. Existing README live evidence is reported historical evidence, not new results from this review. |

Google documents the `appendRow` formula behavior in the [Sheet API reference](https://developers.google.com/apps-script/reference/spreadsheet/sheet#appendRow(Object)). The new test checks adapter behavior with a mocked Sheet; a live Google Sheet rendering check remains outstanding.

## Fit against the supplied n8n FDE requirements

- **Integration delivery:** good portfolio evidence for adapting Forms, Sheets, OAuth file access and a model API into an operator-owned workflow. The case study explains business boundaries and technical tradeoffs clearly.
- **Engineering rigor:** deterministic code, regressions, credential-free exports and the added CI help. Runtime schema checks, concurrency-safe persistence, recoverable failures and real runtime regression coverage remain the most valuable improvements.
- **Reusable custom integrations:** this repository deliberately uses existing nodes. The H@H TypeScript custom node is complementary evidence; do not retrofit a custom node here without repeated integration requirements.
- **Production/enterprise experience:** repository contents cannot establish customer production ownership, enterprise on-site delivery, measured business impact or support SLAs. Present this as a synthetic pilot and discuss observed failures only when supported by actual records.

Suggested interview demonstration: explain one input-to-review path, show the zero-versus-unknown regression, rerun without overwriting a coach edit, then explain a known concurrency/recovery limitation and its acceptance test. Use the separate H@H node to demonstrate TypeScript credentials, API contracts and failure handling.

## Verification in this review

`npm test`: 55 workflow checks, release assertions and the new intake literal-cell assertions passed. No Google, Gemini or live n8n execution was performed. The new CI must be checked on the pull request before merging.
