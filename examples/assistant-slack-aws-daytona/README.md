# assistant-slack-aws-daytona — full Claude-Tag-style Slack platform on AWS

> One of the [Flue Agent Reference Architectures](../../README.md). See
> [AGENTS.md](../../AGENTS.md) for the shared patterns,
> [docs/adding-skills.md](../../docs/adding-skills.md) for skills, and
> [docs/aws-claude-tag-architecture.md](../../docs/aws-claude-tag-architecture.md)
> for the full design + decision log.

A "tag `@Claude` in a Slack channel and it works like a teammate" platform —
verified live with **real Slack + AWS + Bedrock**. The heavier sibling of
[`assistant-slack-daytona`](../assistant-slack-daytona/) (the minimal idiomatic
`@flue/slack` server): **this** is the serverless AWS pipeline with durable
per-thread memory, a 👀 pickup signal, agent self-scheduling, per-channel
governance, a pluggable sandbox, and a multiplayer **spec-interview / plan-mode**
flow that produces a Markdown spec.

```
Slack @mention
  → API Gateway (HTTP API, POST /slack/events)
  → verify-Lambda (zip)         verify HMAC over raw body+ts, ack 200 fast,
                                answer url_verification, enqueue the turn
  → SQS FIFO (MessageGroupId=conversationId, dedup=event_id, DLQ maxReceive=3)
  → consumer Lambda (container) one message at a time (batch=1, FIFO single-writer)
       👀 reactions.add on pickup (before the slow run)
       runs: flue run --id <conversationId> --input {message}
       → real Flue agent on Bedrock (us.anthropic.claude-sonnet-4-6)
       → posts the reply / question / spec back to Slack
```

## Why a Lambda pipeline (not the `@flue/slack` server)

Slack needs a fast `200` ack (3 s) but the agent turn takes much longer, so the
work must be **async, after the response**. That's the whole shape:

- **verify-Lambda** (always-addressable, scale-to-zero) verifies the Slack
  signature, answers `url_verification`, and enqueues the turn — it never runs
  the model.
- **SQS FIFO** keyed by conversation gives **one-writer-per-conversation**
  ordering (turns in one thread are strictly serialized; different threads run in
  parallel) and a DLQ for Slack's retries.
- **consumer Lambda** (container image) runs the real Flue agent to completion
  via `flue run --id`, then the agent posts back to Slack.

Lambda is the thin orchestration layer; **Bedrock** is inference; **Daytona** (or
another provider) is compute. See the
[architecture doc](../../docs/aws-claude-tag-architecture.md) for how each
behavior maps to AWS primitives and the alternatives considered.

## Memory: keyed per conversation (thread)

The agent instance id **is** the conversation id `conv:<team>:<channel>:<rootTs>`
— so each thread (an interview, a spec, a task) is its own durable conversation
and several can run in one channel without bleeding together. A reply or
`@mention` inside a thread routes to that same conversation. (An earlier version
keyed per *channel*; per-thread is the right scope for focused, bounded work like
a spec.)

**Durable memory: S3** — chosen for text-heavy channels (no size limit, flat
per-PUT cost, ~11× cheaper storage than DynamoDB, no chunking). Verified to
survive a forced cold start. `src/s3-adapter.ts` keeps Flue's
submission/run/event machinery in in-memory SQLite and swaps only
`executionStore.sessions` for S3 (one object per session) — sound because each
SQS turn is a one-shot `flue run` (only the session crosses processes) and FIFO
already serializes writes per conversation. Validated against Flue's own 55-test
contract suite (`spikes/s3-sessions`). No VPC/NAT — reached over the Lambda role.

`db.ts` preference: `SESSIONS_BUCKET` (S3) > `SESSIONS_TABLE` (DynamoDB alt,
`src/dynamo-adapter.ts`, handles 400 KB-item chunking + 1 MB-Query pagination) >
local SQLite file (dev).

## Features

- **👀 pickup ack** (`handler.ts`) — adds an `eyes` reaction the instant a turn is
  dequeued, before the slow run. Best-effort; needs `reactions:write`.
- **Self-scheduling** (`src/tools/schedule.ts`) — the `schedule_followup` tool
  creates a one-shot **EventBridge schedule** that, when it fires, enqueues a
  `[scheduled follow-up]` turn into the same FIFO queue, so a self-wake flows
  through the same path as a human turn ("follow up in 6 h" / pursue over days).
- **Pluggable sandbox** (`src/sandbox/`) — the agent calls
  `sandboxProvider().forChannel(id)` and never names a backend.
  `SANDBOX_PROVIDER` selects `local` (default), `daytona` (per-conversation
  remote Linux box, verified live), or `ec2-ssm` (a stub showing the contract).
  Adding a backend = implement Flue's 9-method `SandboxApi` + one line in
  `registry.ts`.
- **Governance — per-channel scoping** — see [below](#governance-per-channel-scoping).
- **Spec-interview / plan-mode** — see [below](#spec-interview--plan-mode).

## Set up the Slack app

The agent receives [Events API](https://api.slack.com/apis/events-api) deliveries
at `POST /slack/events` (your API Gateway URL) and replies with the Web API. You
need the API Gateway URL before finishing — call it `<REQUEST_URL>`.

1. **Create the app** — <https://api.slack.com/apps> → **Create New App** →
   **From scratch**. Name it, pick your workspace.
2. **Bot Token Scopes** (**OAuth & Permissions → Scopes**):
   - `app_mentions:read` — receive `@mention` events.
   - `chat:write` — post messages/replies.
   - `reactions:write` — add the 👀 pickup reaction.
3. **Install to Workspace** → approve → copy the **Bot User OAuth Token**
   (`xoxb-…`) → `SLACK_BOT_TOKEN`.
4. **Signing Secret** — **Basic Information → App Credentials** → copy →
   `SLACK_SIGNING_SECRET`.
5. **Event Subscriptions** → On:
   - **Request URL:** `<REQUEST_URL>` (e.g.
     `https://abc123.execute-api.us-west-2.amazonaws.com/slack/events`). Slack
     sends a `url_verification` challenge; the verify-Lambda answers it once the
     stored `SLACK_SIGNING_SECRET` matches, so set the secret first (step 8).
   - **Subscribe to bot events:** add **`app_mention`**. (That's all — the bot
     only ever receives messages that tag it; it never listens to channel
     chatter. See [Replying in threads](#replying-in-threads).)
   - **Save**, reinstall if prompted.
6. **Invite** the bot to a channel: `/invite @your-app-name`, then `@mention` it.

> **Reinstalling can rotate the bot token.** After any scope change + reinstall,
> re-copy the `xoxb-…` token and update the `SLACK_BOT_TOKEN` value in Secrets
> Manager (step 8), then bounce the consumer so it re-reads the secret.

### Validate without the full round-trip

- **Bot token good?** `curl -s -XPOST https://slack.com/api/auth.test
  -H "Authorization: Bearer $SLACK_BOT_TOKEN"` → `"ok":true`.
- **Missing scope?** A Web API call returns `"error":"missing_scope"` — add it,
  reinstall, retry.
- **Request URL won't verify?** The verify-Lambda's `SLACK_SIGNING_SECRET` must
  match the app's, and API Gateway must be reachable. A signed test:
  ```
  basestring = "v0:" + timestamp + ":" + rawBody
  X-Slack-Signature = "v0=" + HMAC_SHA256(signingSecret, basestring)   // hex
  ```
  POST `{"type":"url_verification","challenge":"abc"}` with valid headers → it
  echoes `abc`; a bad signature → `401`.

## Deploy the AWS pipeline

The stack: ECR (consumer image), SQS FIFO + DLQ, IAM roles, the verify-Lambda
(zip) + consumer Lambda (container), API Gateway, an S3 bucket (sessions/config/
thread-markers), a Secrets Manager secret, and — for self-scheduling — an
EventBridge scheduler-target role. All are AWS-API-only; **no public endpoint
except the API Gateway** Slack posts to.

`.aws-resources.env` (gitignored) records the concrete resource names/ARNs of a
deployment for teardown. The exact create commands used to stand this up live in
the build log / architecture doc; the load-bearing settings:

- **SQS FIFO**: `ContentBasedDeduplication=true` (EventBridge's SQS target sets
  no dedup id), `VisibilityTimeout=900` (= consumer max), DLQ `maxReceiveCount=3`.
- **consumer**: container image, 900 s timeout, SQS event-source mapping
  **`batch=1`** (strict one-turn-at-a-time per conversation).
- **IAM** (least privilege): verify → `sqs:SendMessage` + read secret + read
  `threads/*`; consumer → SQS receive/delete + `bedrock:InvokeModel` + read
  secret + S3 (sessions/config/threads) + `scheduler:CreateSchedule` +
  `iam:PassRole` on the scheduler-target role; scheduler-target → trusts
  `scheduler.amazonaws.com`, `sqs:SendMessage` only.

### Secrets (Secrets Manager)

One JSON secret holds `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, and (when using
the daytona sandbox) `DAYTONA_API_KEY`. The Lambdas read it at boot and cache it
per warm container — **bounce the function (update its config) after changing the
secret** so it re-reads.

### Consumer env vars

| Var | Purpose |
|---|---|
| `SLACK_SECRET_ID` | the Secrets Manager secret ARN |
| `SESSIONS_BUCKET` | S3 bucket for sessions / config / thread-markers |
| `SANDBOX_PROVIDER` | `local` (default), `daytona`, `ec2-ssm` |
| `SCHEDULE_QUEUE_ARN` / `SCHEDULE_ROLE_ARN` | self-scheduling target + role |
| `HOME=/tmp` | Lambda's only writable path |

## Replying in threads

The bot only receives messages that **@mention** it — deliberate, so it never
sees unrelated channel chatter (subscribing to all messages would mean Slack
forwarding every message in the channel). A mention **inside a thread** carries
`thread_ts`, so it routes to that thread's conversation. So you continue a
conversation by replying in the thread **and tagging the bot**.

> Opt-in alternative: set `ALLOW_MESSAGE_EVENTS=true` on the verify-Lambda **and**
> subscribe to `message.channels` to let people reply *without* tagging the bot.
> The verify-Lambda still hard-filters to only enqueue replies in threads it
> tracks — but Slack then forwards every channel message, so only enable it in a
> private/dedicated channel where that's acceptable.

## Spec-interview / plan-mode

A multiplayer intake flow (skill: `.agents/skills/spec-interview/`). `@mention`
the bot to start ("scope a feature", "start a spec"); it asks **one question at a
time** as top-level channel messages, anyone can answer (in-thread, tagging the
bot), and when enough is gathered it posts a **Markdown spec** — which people
refine by replying. Model-driven: the skill says *what* to cover; the agent
manages the flow and remembers the conversation across turns.

- `src/tools/interview.ts` — `post_to_channel` (top-level; auto-registers its
  message as a routable thread), `post_in_thread`, `register_thread`.
- `src/interview/thread-marker.ts` — maps a thread root → conversation id (S3) so
  replies route back; an untracked thread is dropped by the verify-Lambda.

## Governance: per-channel scoping

Admins scope a channel by putting a JSON object at
`s3://<SESSIONS_BUCKET>/config/<urlencoded-channelId>.json`:

```json
{ "tools": ["reply_in_slack", "post_to_channel"], "model": "amazon-bedrock/us.anthropic.claude-sonnet-4-6" }
```

The consumer (`src/governance/channel-config.ts`) loads it at turn start and
passes the allowlist + model to the agent via `CHANNEL_TOOLS`/`CHANNEL_MODEL`;
the agent builds its toolset from the allowlist, so a disallowed tool is
genuinely **absent**, not just declined. No config → all tools (safe default).
Verified live: a reply-only channel could not schedule a follow-up.

> **Who writes the config, and when?** Channel IDs don't exist until a channel is
> used, so config can't be pre-authored by ID. The scoping *hook* defaults safely;
> the authoring/bootstrapping policy (hand-edit S3 · a `/claude-config` slash
> command · a `_default.json` team fallback · an external store) is an open design
> choice — see `docs/STATUS.md`.

Spend caps + an audit log are the remaining governance pieces (not yet built).

## Run locally

```bash
npm install
cp .env.example .env   # Bedrock via AWS_PROFILE; add SLACK_*, DAYTONA_* as needed

# One-shot, no Slack — drive the agent directly (the path the consumer uses):
./node_modules/.bin/flue run assistant --id 'conv:T:C:1' \
  --input '{"message":"what does `seq 1 5 | paste -sd+ | bc` print?"}'
```

## Hard-won wiring lessons (verified the hard way)

- **`db.ts` MUST live in the source root** (`src/`), not the project root, or Flue
  silently ignores it and memory is in-memory only.
- **Lambda Node RIC does not type-strip a `.ts` entrypoint** — transpile
  `handler.ts` → `handler.mjs` (esbuild) at image build; `flue run` reads the
  `.ts` project sources fine.
- **`@flue/cli` must be a prod dependency** — the consumer runs `flue run`.
- **SQS visibility = consumer max (900 s)** — a failed turn holds its conversation
  group that long; purge the queue when iterating mid-debug.
- **Lambdas cache secrets per warm container** — bounce after changing a secret.
- **EventBridge’s SQS target sets no dedup id** — the FIFO queue needs
  `ContentBasedDeduplication=true` or scheduled wakes are silently rejected.
- **IAM `s3:ListBucket` on the bucket arn** is needed in addition to object
  actions, or the S3 session adapter fails with AccessDenied.

## Cost / lifecycle

~zero idle: Lambdas + SQS + S3 cost nothing at rest; each turn is a small Bedrock
charge; each active conversation with `SANDBOX_PROVIDER=daytona` runs a box until
Daytona’s auto-stop/auto-delete reaps it. Tear down via `.aws-resources.env`, and
rotate the Slack signing secret + bot token afterward (they were used live).
