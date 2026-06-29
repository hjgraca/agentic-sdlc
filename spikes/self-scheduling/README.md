# Spike: self-scheduling (EventBridge Scheduler → FIFO) on real AWS

**Question:** can the agent "take initiative" / "pursue a project over hours-days"
by scheduling its own future wake — and does that wake flow through the same
per-channel single-writer path? Tested on **real** AWS (acct <ACCOUNT_ID>,
us-west-2). No public endpoints; resources `spike-` prefixed and torn down.

**Answer: yes.** ✅

```bash
npm install
AWS_REGION=us-west-2 SPIKE_STAMP=$(date +%s) npm run spike   # ~2 min (waits for the wake)
```

## What it proves

An app-created **EventBridge Scheduler** one-shot schedule (`at(~90s)`) fires
later and delivers a **synthetic turn** (`{type:'slack.scheduled_wake',
channelId, …}`) into the channel's **SQS FIFO** queue with
`MessageGroupId=channelId`. So "follow up in 6h" / multi-day pursuit re-enters
through the exact single-writer path verified in `spikes/single-writer` — no
separate code path for scheduled vs. user-initiated turns.

EventBridge Scheduler beats a Durable Object alarm here: arbitrarily many named
one-shot schedules per channel vs. DO's single alarm.

## Learnings (things that bit, now documented)

- **IAM role assumability is eventually consistent.** A freshly created role is
  not instantly assumable; `CreateSchedule` validates the target role at create
  time and throws `ValidationException` until it propagates. Retry through the
  window (the spike polls ~5s × 12).
- **IAM `Description` is ASCII-only** (`[	
 -~¡-ÿ]`).
  A `→` arrow fails with a `ValidationError`. Use plain ASCII.
- **FIFO target via Scheduler sets no dedup id**, so the queue needs
  `ContentBasedDeduplication=true` (Scheduler can set `MessageGroupId` but not
  `MessageDeduplicationId`).
- **Least-privilege target role:** trust `scheduler.amazonaws.com` only; inline
  policy = `sqs:SendMessage` on the single queue ARN.

## What it does NOT prove

- Durable bookkeeping of *which* schedules exist per channel (you'd track these in
  Aurora/DDB so the agent can list/cancel its own pending wakes).
- Granularity below ~1 minute (EventBridge minimum); fine for Slack cadence.
- The agent actually *deciding* to schedule — that's the model/skill layer.
