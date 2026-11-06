# Deployment case study

[Back to project overview](../README.md)

## Brief and delivery boundary

The request was to adapt an existing automation package to a local n8n installation and an existing Google Workspace setup. The intended operator is a coach tracking individual goals across eight weeks. Inputs are predominantly photos, supplemented by short descriptions; outputs are meal feedback, daily and weekly summaries, and missing-upload reminders.

The engagement constraints shaped the architecture:

- Preserve the existing workflows and data.
- Use fictional clients and synthetic images throughout verification.
- Do not read or transmit real client health records.
- Do not automate outbound client messages.
- Continue through implementation and debugging; involve the account owner when login or new authorization is required.
- Produce something the operator can review and maintain without a bespoke application.

The implementation therefore used a separate test spreadsheet, separately named n8n workflows, and an explicit approval surface. Public templates were extracted from that working environment, stripped of account bindings, and reset to preview-only mode.

This was an implementation and integration exercise based on an existing package. It is not presented as a greenfield invention or an enterprise production deployment.

## Translating requirements into acceptance criteria

| Requirement | Technical interpretation | Acceptance check |
| --- | --- | --- |
| Feedback must reflect the individual | Join `client_id` to a profile before building the AI request | Two clients with different goals retain their own goal context |
| Photos are the primary input | Authenticated file download plus multimodal request; text-only fallback when no photo is supplied | Image and text branches both produce pending-review rows |
| Eight weeks means each person's course | Use course start + 7-day intervals, bounded to 56 days | Test weeks 1–8 and reject week 9 |
| Coaches must trust the reporting | Derive metrics in code from explicit fields | Missing verification remains unknown; numeric zero remains zero |
| Coaches can edit the final wording | Store approved copy separately and skip existing output IDs | Rerun after editing does not overwrite approval text |
| Reminders should not punish processing delays | Check pending intake as well as processed meals | A pending submission suppresses a missing-log reminder |
| Keep delivery semi-automatic | No outbound send node | Approval state alone cannot transmit a message |

## Integration problems and their resolutions

### Batch processing and item context

A single successful item is insufficient evidence for a branched workflow. The input validator was changed to preserve all incoming items, with paired-item metadata; the meal workflow gained a one-item loop, and downstream context lookups were aligned to the linked item.

**Verification:** a live run processed two text meals and one image meal. The rerun skipped the three persisted IDs. This validates the observed batch scenario; it is not a load or concurrency test.

**Reusable lesson:** include multiple items with different branches in the acceptance fixture. Check both row identity and content, not only the final execution status.

### Model availability and transient failures

The initially configured model returned repeated service-unavailable responses. A fallback candidate was also unavailable to the account. Diagnostic requests established an accessible model before the full pipelines were rerun. Gemini HTTP nodes use a maximum of three attempts with a five-second wait between retries.

**Verification:** the selected model completed text, image, daily-summary, and weekly-summary calls in the pilot.

**Boundary:** this is a fixed tested model selection with finite retries, not an implemented multi-provider failover policy. Future deployers must verify their own model access, quota, and cost.

### Private file access

A private image uploaded through a different application could not be downloaded through the existing n8n credential. A synthetic image created through the n8n-authorized application could be retrieved and analysed.

**Decision:** retain private access and document the application's file-access boundary rather than solve the test by making the file public.

**Boundary:** arbitrary private uploads are still an open acceptance item. An account being signed in and able to view an image is not sufficient proof that an OAuth application can fetch it.

### Date coercion and missing values

Spreadsheet writes could coerce ISO dates into native date values. The n8n append nodes were configured to write RAW values; Apps Script normalizes submitted date values. The input validator rejects invalid calendar dates rather than accepting a matching string shape alone.

Separately, truthiness-based fallbacks could turn numeric zero into “unknown.” Summary prompt generation now distinguishes an empty metric from `0`.

**Verification:** regression tests cover an invalid calendar date, a valid leap day, and zero-preserving daily and weekly prompts. Live form submission preserved the intended date and course window.

### Unsupported AI confidence

Live drafts sometimes asserted that a goal had been achieved despite missing human verification. The output layer was updated to detect a subset of these statements and replace the client-facing wording with a conservative prompt for more information. Summary drafts include deterministic facts before the narrative.

**Verification:** the observed daily phrase asserting full goal compliance was replayed through the corrected guard. The corresponding regression now runs in `tests/release.cjs`.

**Boundary:** keyword checks can have false positives and false negatives. They do not validate all factual claims, and internal summaries are still fallible. The human approval boundary is essential.

## Architecture decisions and alternatives

| Decision | Why it fit this pilot | Cost / trigger to revisit |
| --- | --- | --- |
| Sheets as review workspace | The operator can inspect and edit records without learning a new app | Full-sheet reads, weak transactional guarantees, and limited access-control granularity; revisit when volume or multiple operators require it |
| Forms + Apps Script normalization | Two simple forms capture goals and meals; one adapter establishes a stable schema | Trigger ownership and permissions need an explicit operational owner |
| Polling rather than inbound local webhook | Works with a local Mac without a public ingress endpoint | Polling latency and dependence on host availability |
| Native nodes + Code + HTTP Request | Fast adaptation while keeping API details and business rules inspectable | Extract a custom component when repeated integrations justify versioning and a stable interface |
| Append with stable-ID precheck | Protects existing coach edits during ordinary reruns | Race conditions remain; requires database uniqueness for concurrent workers |
| Deterministic reminder template | Eligibility is a simple data comparison, so an AI call adds little value | Message variation can be added later if there is evidence it helps operators |
| No outbound messaging | Keeps the pilot focused on preparation and review | A future send integration needs explicit consent, delivery state, retries, and auditability |
| Skip existing summaries | Avoids silently changing previously reviewed text | Late decisions require manual corrections until revision-aware regeneration exists |

## Operator handoff

The operator owns personal goals, expected meal counts, verification decisions, approved text, and actual send timestamps. The deployer owns credentials, triggers, schedules, schema compatibility, and failure recovery.

Routine operation should not require changing a workflow. A coach reads the AI draft, checks missing information, edits the approval field, and manually copies that version to the communication platform. A separate `coach_goal_met` decision drives metrics; the model's assessment does not.

The [deployment guide](setup.zh-TW.md) documents exact bindings and troubleshooting. The [demo walkthrough](demo.md) provides a reproducible acceptance sequence. These make the implementation transferable rather than dependent on the original debugging session.

## Product feedback from deployment friction

These are proposals derived from this pilot, **not shipped features, upstream contributions, or validated demand across customers**.

| Signal from the pilot | Proposed reusable capability | Why it may matter | Evidence needed before product investment |
| --- | --- | --- | --- |
| A user can view a Drive image, but the workflow cannot retrieve it | Private-file access diagnostic pattern showing identity, scope expectations, and a safe test download | Reduces confusion between account access and application access | Repeated support cases across file providers; measured time to resolve |
| Single-item success hides wrong context in batch branches | Reusable workflow acceptance fixtures for linked items and branch coverage | Detects silent cross-record errors before rollout | Several representative workflows and maintainability review |
| Retry-safe generation must preserve edited output | Review-aware persistence pattern with generation ID, revision, and human-owned fields | Prevents a rerun from erasing operator work | Agreement on update semantics and a durable storage backend |
| Draft narratives can contradict deterministic metrics | Structured-output validation plus source-linked review evidence | Makes disagreement visible to reviewers | A labeled evaluation set and measured error/approval burden |
| A local host can miss a course-relative report window | Watermark-based catch-up reporting pattern | Separates eligibility from a single wall-clock event | Restart and replay tests, concurrency model, explicit ordering rules |

The immediate reusable deliverable is the workflow package and runbook. A custom node would be premature for one deployment; the strongest next candidate is the review-aware persistence pattern if the requirement repeats.

## A proposed five-day deployment plan

This is a plan for a future time-boxed engagement, **not a claim that this project was delivered on-site in five days**.

| Day | Focus | Exit condition |
| --- | --- | --- |
| 1 | Confirm operator journey, data access, deployment owner, and success measures | Agreed scope, synthetic fixtures, permission map, rollback plan |
| 2 | Establish one vertical slice from form to review row | Text and a newly uploaded private image complete with the intended credentials |
| 3 | Add reporting, reminders, deduplication, and failure scenarios | Boundary fixtures pass; human edits survive reruns |
| 4 | Exercise restart recovery, approval process, and AI review quality | Named unresolved risks and a scoped go/no-go decision |
| 5 | Operator-led walkthrough and handoff | Operator completes the agreed journey; monitoring owner and next actions recorded |

For this codebase, recovery and arbitrary-upload access remain open work. They cannot be claimed complete by placing them in a delivery plan.

## Measuring value in a subsequent pilot

| Measure | Collection method | Current status |
| --- | --- | --- |
| Preparation time per reviewed meal | Compare matched manual and assisted tasks; separate review time from generation time | Not measured |
| Draft acceptance / edit burden | Record accepted, edited, rejected; compare meaning-changing edits | Not measured |
| Incorrect reminder rate | Review eligible clients against intake at the reminder cutoff | Scenario-tested; no longitudinal rate |
| End-to-end latency and API cost | Timestamp intake, completion, and approval; track model usage | Not benchmarked |
| Recovery success | Restart during scheduled work and replay duplicate submissions | Not implemented / not measured |

A successful pilot should improve preparation effort without increasing factual corrections or weakening approval ownership. Targets should be agreed with the operator after establishing a baseline.

## Production-readiness boundary

Before real records are used: validate private-file ingestion, agree data authorization and retention, add operator-visible failures, validate output quality, and establish host availability plus missed-run recovery. Before multiple concurrent workers: introduce durable uniqueness and revision-aware updates. Before higher volumes: replace unbounded sheet scans with an indexed or incremental read strategy and measure quota/cost behavior.

The value of the pilot is a working vertical slice, tested business rules, and a clear next deployment scope. It is not evidence of clinical effectiveness or an already hardened enterprise service.
