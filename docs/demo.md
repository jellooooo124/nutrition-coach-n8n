# Interview demo: from intake to reviewed feedback

[Back to project overview](../README.md)

This is a presenter runbook for the existing workflow package. It describes actions to demonstrate, not an assertion that the viewer's environment is already configured. Use only fictional clients and synthetic images.

## Suggested 8–10 minute walkthrough

### 1. Frame the problem — 60 seconds

Explain the operator's job: understand an individual goal, review photo-heavy meal records, maintain a longitudinal view, and follow up when records are missing. Point out the delivery boundary: the workflow prepares evidence and copy; the coach owns approval and sending.

Show the four workflows and the six-tab data model. Avoid starting with every node on the canvas.

### 2. Demonstrate one complete meal — 2 minutes

Prerequisites: follow the [setup guide](setup.zh-TW.md); select credentials, confirm private-image access, and use only the isolated test spreadsheet.

- Create `TEST-8WK-DEMO-A` through the goal form: three expected meal slots, one goal meal, and a clearly observable vegetable-recording habit.
- Submit one meal through the actual responder URL. Use a synthetic image and state that portion and consumption are unknown.
- Show the normalized `Meal_Intake` row, including the stable submission ID and ISO date.
- Run WF01 manually or wait for polling if it has been published.
- Show the resulting goal-aware draft, missing information, `coach_goal_met=待確認`, and `review_status=待教練審核`.

Explain which parts are AI-generated and which are set deterministically. The image is evidence of visible food, not proof of consumption.

### 3. Demonstrate human ownership and rerun behavior — 90 seconds

Edit the approval field with a short, cautious message and select `已核准`. Rerun WF01. Confirm the existing submission is skipped and the edited text remains unchanged.

Do not send a message as part of the demo. Show that the communication handoff is manual and that the send timestamp remains empty.

### 4. Demonstrate reporting semantics — 2 minutes

Prepare synthetic records for yesterday and a separate client whose course started seven days ago. Run WF02 and WF03. Show the difference between recording coverage and verified goal progress.

| Fixture | Expected interpretation |
| --- | --- |
| 3 meal slots recorded, none verified | 100% coverage; goal progress unknown |
| No records | 0% coverage when three meals were expected; no inference that the client failed |
| Seven weekly slots, 21 expected, four verified yes, seven target | 33% coverage; 57% verified progress |

If a weekly workflow has no output, inspect course eligibility before assuming a failure. It only creates a report on a full-week boundary.

### 5. Demonstrate one failure boundary — 60 seconds

Show either an invalid calendar date rejected by validation or a pending intake that suppresses a missing-log reminder. Explain why a processing delay should not become a client-facing nudge.

For private-file errors, use a synthetic fixture only. Explain the OAuth application-access boundary; do not broaden permissions or expose a file just to make the demo pass.

### 6. Close with the deployment decision — 60 seconds

State what is verified and what would block real-world rollout: arbitrary private uploads, failure visibility, durable recovery, and output-quality evaluation. Explain why the next step is targeted hardening rather than a new dashboard or autonomous messaging.

## Offline fallback

If credentials or API availability prevent a live demo:

```bash
npm test
```

Walk through the clock-controlled week-boundary tests and the unsupported-claim regression. Clearly label this as offline logic verification. Do not describe it as a successful live integration run.

## Capturing a workflow screenshot for an application

The current repository includes diagrams and importable workflows, not a published runtime screenshot. To capture evidence safely:

1. Import the sanitized WF01 into a separate, inactive workflow.
2. Fit the canvas so its validation, branch, AI, and review-write stages are legible.
3. Use the neutral workflow name; keep credential panels and execution payloads closed.
4. Exclude account details, private sheet links, and unrelated browser tabs.
5. Label the image as a workflow-canvas view. A screenshot of an imported template is not proof of a successful execution.

A runtime demonstration should separately show synthetic input, output, and the preserved human edit. Do not use a designed architecture diagram as if it were a screenshot from n8n.
