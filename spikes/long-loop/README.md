# Spike: long-loop checkpoint / resume (days-long tasks)

**Question:** how does a task that "runs over hours or days" survive when no
process is pinned that long? Local Flue durable store, no credentials.

**Answer:** it doesn't run as one long process — it runs as **many short woken
turns over a durable checkpoint**: do one bounded chunk → persist progress →
schedule the next wake → exit → wake → resume. ✅ Verified across 4 separate
processes, including a duplicate (idempotent) wake.

```bash
npm install
npm run spike     # w1, w2, DUPLICATE w2, w3, w4 — 4 stages over 5 invocations
```

## What it proves

- **Resume across process boundaries.** A 4-stage "project"
  (research → draft → review → publish) advances exactly one stage per process;
  each fresh process reads the durable checkpoint and continues where the last
  stopped. No stage is repeated or skipped.
- **Idempotent re-wake.** A duplicate delivery (same `wakeId`) is a no-op — it
  does not double-advance. Required because SQS is at-least-once and EventBridge
  can double-fire.

## Mapping to the AWS platform

| Spike piece | Production |
|---|---|
| one `node loop.ts wake <id>` | one EventBridge wake → one FIFO turn for the channel |
| load/save session | `db.ts` → Aurora (durable per-channel session, verified) |
| **checkpoint store** | `SessionData.metadata` — app-owned, "Flue never reads or writes keys here", travels with the session |
| `scheduleNext` branch | `CreateSchedule(at(now+Δ))` (verified in `spikes/self-scheduling`) |
| `lastWakeId` dedup | dedup on Slack `event_id` / `dispatchId` |

So "pursue over days" = the persistence + self-scheduling + single-writer pillars
composed, with progress living in the session's `metadata`. No new primitive.

## Design note: where the checkpoint lives

`SessionData.metadata` is the natural home — it's application-owned and rides the
same durable per-channel session we already proved persists/reloads
(`spikes/db-persistence`). The conversation `entries[]` are the model's memory;
`metadata.project` is the *structured* task state the wake loop reads without
re-parsing the transcript.

## What it does NOT prove

- A *partial-stage* crash (process dies mid-stage). Here a stage is atomic per
  wake; real stages should be idempotent or sub-checkpointed so a retry is safe.
- The model actually *planning* the stages — that's the agent/skill layer; this
  spike models the durable control loop around it.
