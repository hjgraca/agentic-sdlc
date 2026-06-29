# e2e: Claude-Tag-style Slack assistant on AWS (fully wired)

The end-to-end realization of `docs/aws-claude-tag-architecture.md`, verified
with **real Slack + real AWS + real Bedrock** on 2026-06-29.

```
Slack @mention
  → API Gateway (HTTP API, POST /slack/events)
  → verify-Lambda (zip)         verify HMAC over raw body+ts, ack 200 fast,
                                answer url_verification, enqueue the turn
  → SQS FIFO (MessageGroupId=channelId, dedup=event_id, DLQ maxReceive=3)
  → consumer Lambda (container) one message at a time (batch=1, FIFO single-writer)
       👀 reactions.add on pickup (before the slow run)
       runs: flue run --id slack:<team>:<channel> --input {message}
       → real Flue agent on Bedrock (us.anthropic.claude-sonnet-4-6)
       → reply_in_slack tool → chat.postMessage into the turn's thread
```

**Memory is keyed per CHANNEL** (`slack:<team>:<channel>`), not per thread —
Claude Tag's "one Claude per channel; anyone can pick up the conversation."
Verified live: "remember X" in one mention is recalled by a separate mention in
the same channel. The reply destination (thread) is passed per-turn via env
(`SLACK_CHANNEL_ID`/`SLACK_THREAD_TS`), since it can't ride on the channel-scoped
id.

**Durable memory: S3** — chosen for text-heavy channels (no size limit, flat
per-PUT cost, ~11x cheaper storage than DynamoDB, no chunking). Verified to
survive a forced cold start — recalled a fact across a guaranteed-fresh
container, which `/tmp` SQLite could not. The adapter (`src/s3-adapter.ts`) keeps
Flue's submission/run/event machinery in in-memory SQLite and swaps only
`executionStore.sessions` for S3 (one object per session) — sound because each
SQS turn is a one-shot `flue run` (only the session crosses processes) and SQS
FIFO already serializes writes per channel (so no conditional writes needed).
Validated against Flue's own 55-test contract suite (`spikes/s3-sessions`). No
VPC/NAT — S3 is reached over the Lambda role (IAM needs `s3:ListBucket` on the
bucket plus Get/Put/DeleteObject on `<bucket>/*`).

`db.ts` preference: `SESSIONS_BUCKET` (S3) > `SESSIONS_TABLE` (DynamoDB, alt
adapter in `src/dynamo-adapter.ts`, handles 400KB-item chunking + 1MB-Query
pagination) > local SQLite file (dev).

Verified warm round-trip ~6s; cold ~38s (Lambda init + Flue boot + Bedrock turn).

## Components

- `verify/index.mjs` — verify-Lambda (Node zip). HMAC verify, url_verification,
  enqueue `{channelId, teamId, threadTs, text, eventId}` with
  `MessageGroupId=channelId`, `MessageDeduplicationId=event_id`.
- `handler.ts` → `handler.mjs` (esbuild at image build) — consumer Lambda.
  Reads the Slack bot token from Secrets Manager (cached per warm container),
  shells out to `flue run --id` per SQS record.
- `src/agents/assistant.ts` — channel-keyed Flue agent, durable memory via
  `src/db.ts`, `reply_in_slack` tool bound to the thread from the agent id.
- `Dockerfile` — consumer image on `public.ecr.aws/lambda/nodejs:22`.
- **Pluggable sandbox** (`src/sandbox/`): the agent uses
  `sandboxProvider().forChannel(id)` and never names a backend. `SANDBOX_PROVIDER`
  env selects `local` (default, no infra), `daytona` (per-channel remote box,
  verified), or `ec2-ssm` (stub showing the contract). **Adding a backend**
  (EC2/k8s pod/Fargate/SaaS) = implement Flue's 9-method `SandboxApi`
  (`exec` + 8 file ops), wrap with `createSandboxSessionEnv`, add one line to
  `registry.ts`. Switch backends with one env var; for daytona also set
  `DAYTONA_API_KEY` (+ optional `DAYTONA_SNAPSHOT`).
- **👀 pickup ack**: the consumer adds an `eyes` reaction to the user's message
  the instant it dequeues (before the slow agent run) via `reactions.add` —
  best-effort, never blocks the work. Needs the mention's `messageTs` carried
  through SQS (set by the verify-Lambda).
- **Self-scheduling** (`src/tools/schedule.ts`): the agent's `schedule_followup`
  tool creates a one-shot **EventBridge schedule** that, when it fires, enqueues
  a `[scheduled follow-up]` turn into the SAME per-channel FIFO queue — so a
  self-wake flows through the same single-writer path as a human turn, and the
  same channel-keyed agent (with its S3 memory) wakes and acts. Verified live:
  agent scheduled itself → EventBridge fired ~1 min later → agent woke and acted.
  Needs a scheduler-target IAM role (trusts `scheduler.amazonaws.com`,
  `sqs:SendMessage`) the consumer passes via `iam:PassRole`, and consumer
  `scheduler:CreateSchedule`. The FIFO queue must have
  `ContentBasedDeduplication=true` (EventBridge's SQS target sets MessageGroupId
  but no dedup id; explicit ids from the verify-Lambda still win).

## Governance: per-channel scoping

Admins scope each channel out-of-band by putting a JSON object at
`s3://<SESSIONS_BUCKET>/config/<urlencoded-channelId>.json`:

```json
{ "tools": ["reply_in_slack"], "model": "amazon-bedrock/us.anthropic.claude-sonnet-4-6" }
```

The consumer (`src/governance/channel-config.ts`) loads it at turn start and
passes the allowlist + model to the agent via `CHANNEL_TOOLS`/`CHANNEL_MODEL`.
The agent (`src/agents/assistant.ts`) builds its toolset from the allowlist, so a
disallowed tool is genuinely **absent** — not just declined. No config → all
tools (safe default). Verified live: a reply-only channel could not schedule a
follow-up because `schedule_followup` wasn't in its toolset.

(Spend caps + audit log are the remaining governance pieces — not yet built.)

## Slack bot scopes

`app_mentions:read`, `chat:write`, `reactions:write`. Adding a scope requires
reinstalling the app, which **rotates the bot token** — update the secret +
bounce the consumer afterward.

## Hard-won wiring lessons (verified the hard way)

- **`db.ts` MUST live in the source root** (`src/` when it exists), not the
  project root, or Flue silently ignores it and memory is in-memory only.
- **Lambda Node RIC does not type-strip a `.ts` entrypoint** — transpile
  `handler.ts` → `handler.mjs` (esbuild) at image build; `flue run` reads the
  `.ts` project sources fine because Node strips those when running directly.
- **`@flue/cli` must be a prod dependency** — the consumer runs `flue run` at
  runtime; `npm install --omit=dev` would drop a devDep.
- **SQS visibility timeout = consumer max (900s)** — a message a failing
  consumer received stays invisible that long; purge when redeploying mid-test.
- **Lambdas cache secrets per warm container** — bounce (update config) after
  changing a secret so it re-reads.
- **FIFO consumer uses `batch=1`** for strict one-turn-at-a-time per channel
  (see spikes/single-writer).

## Cost / lifecycle note

This is a reference deployment. Per-channel durable memory uses **S3** (cold-start
proof; ~zero idle cost). Sandbox is `local()`; swap to the verified Daytona
adapter for isolated per-channel compute. Tear down with the documented resource
inventory (`.aws-resources.env`) when done.
