# Reference architecture: a Claude-Tag-style Slack platform on AWS

A design for "tag `@Claude` in a Slack channel and it works like a teammate" —
**one Claude per channel, shared multiplayer memory, learns over time, takes
initiative, schedules itself, and runs tasks over hours or days** — built on
[Flue](https://flueframework.com) + per-channel [Daytona](https://www.daytona.io)
sandboxes, deployed on AWS.

This is a *living* doc. It records the design we're converging on and which
parts are **verified by a spike** vs. **still assumed**. It is not a finished
build — see [Status](#status--open-questions).

> Scope note: this design is realized end-to-end in the
> [`assistant-slack-aws-daytona`](../examples/assistant-slack-aws-daytona/)
> example. The simpler [`assistant-slack-daytona`](../examples/assistant-slack-daytona/)
> (idiomatic `@flue/slack` server) is its single-turn ancestor.

## The feature → primitive mapping

Pull the Claude Tag feature list apart and every item reduces to one of four
primitives of a **durable, addressable, stateful actor — one per channel**:

| Feature | Architectural demand |
|---|---|
| "one Claude per channel, anyone picks up" | single addressable instance keyed by channel |
| "learns over time / builds context" | durable per-channel memory that persists & grows |
| "works asynchronously over hours/days" | execution that outlives any 15-min limit |
| "takes initiative, follows up on quiet threads" | a scheduler the agent owns |
| "schedule tasks for itself over days" | self-triggered durable wakeups |
| per-channel tool/permission scoping, spend caps | per-instance config + governance |

Cloudflare Durable Objects *are* this actor natively, which is why Flue's
Cloudflare target fits Claude Tag almost 1:1. **On AWS there is no single service
that is a Durable Object** — you assemble the four properties from 3–4 services.
This doc is that assembly.

## The target architecture

```
                       Slack Events API (3s ack, retries, rotating egress IPs)
                                        │  POST, X-Slack-Signature
                                        ▼
                              ┌───────────────────┐
                              │   API Gateway     │
                              └─────────┬─────────┘
                                        ▼
                       ┌─────────────────────────────────┐
                       │  verify-Lambda                   │  HMAC-SHA256 over raw
                       │  (Slack signature + 200 ack)     │  body+timestamp; reject
                       └─────────────────┬───────────────┘  bad sig / stale ts
                                         ▼
                       ┌─────────────────────────────────┐
                       │  SQS FIFO                        │  MessageGroupId = channelId
                       │  (DLQ for Slack retries)         │  → AWS serializes per channel
                       └─────────────────┬───────────────┘
                                         ▼
        ┌────────────────────────────────────────────────────────────┐
        │  Fargate / ECS  —  the Flue node server                      │
        │  · agent instance id = channelId  (one Claude per channel)   │
        │  · db.ts → Aurora Serverless v2   (durable per-channel mem)  │  ✅ verified viable
        │  · DynamoDB lease per channel     (single-writer long loop)  │
        │  · per-channel tool/permission scoping + spend caps          │
        └───────────┬──────────────────────────────┬──────────────────┘
                    │ exec/files (per-channel box)  │ self-schedule
                    ▼                               ▼
            ┌───────────────┐            ┌────────────────────────┐
            │ Daytona       │            │ EventBridge Scheduler  │  named one-shot
            │ sandbox(es)   │            │  ("wake in 6h", days)  │  schedules → re-enqueue
            └───────────────┘            └────────────────────────┘
                                         ┌────────────────────────┐
                                         │ Step Functions         │  ONLY discrete,
                                         │  (optional)            │  well-defined long jobs
                                         └────────────────────────┘
```

## How each Durable-Object property is synthesized

1. **Single addressable instance by id.** Agent instance id = `channelId`. Flue
   keys the durable session by that id, so every turn for a channel targets the
   same conversation. Routing to the same *compute* is handled by single-writer
   (next).
2. **Single-writer (no concurrent turns for one channel).** DO gives this free;
   AWS synthesizes it two ways, used together:
   - **SQS FIFO `MessageGroupId=channelId`** — AWS won't deliver turn 2 for a
     channel until turn 1's message is deleted/visibility-expired. Serializes
     *turns*. ⚠️ Does **not** cover a task that outlives the visibility timeout
     (max 12h).
   - **DynamoDB conditional-write lease per channel** — for ownership of the
     *long loop* that outlives a message. This is the genuinely hard 20%.
3. **Co-located durable state.** DO = embedded SQLite. AWS = `db.ts` →
   **Aurora Serverless v2** (Postgres). Not co-located, but single-digit-ms, and
   it survives host replacement + is shared across replicas. **Flue ships
   `@flue/postgres` officially — one-line `db.ts`, no custom adapter.**
4. **Hibernation / scale-to-zero.** DO evicts when idle, wakes on message. AWS:
   either keep a minimal Fargate task warm, or scale the service to zero and
   cold-start from the SQS backlog. Not byte-for-byte DO hibernation; the one
   property you can't perfectly replicate cheaply.
5. **Self-scheduling.** DO = `alarm()` (one per object). AWS = **EventBridge
   Scheduler**, which gives *arbitrarily many named* one-shot schedules per
   channel — strictly better than DO here. A scheduled wake re-enqueues a
   synthetic turn for the channel, so it flows through the same single-writer path.

## Decisions that are settled (and why)

- **Lambda is wrong for the agent loop.** 15-min hard cap. "Durable Lambda"
  (Temporal/Restate/DBOS or Lambda+queue) lets you *resume* across invocations
  but doesn't lift the ceiling, and slicing an open-ended model loop into
  resumable steps means re-hydrating model/tool state every turn. Lambda is fine
  for the **verify front** (tiny, fast) — not the loop.
- **"Runs over days" = checkpoint → schedule → wake, not a pinned process.**
  Verified against Flue's own docs: Flue does **not** auto-resume an interrupted
  agent loop ("no step-level resume after Durable Object interruption") — *even
  on Cloudflare*. So nobody pins a 3-day process anywhere; you persist state and
  schedule the next wake. This collapses most of the DO-vs-AWS gap to just
  turn-serialization + idle cost.
- **`dispatch()` on Node is fire-and-forget into an in-process, in-memory
  queue.** It resolves on *accept*, not completion, with no public
  await-to-completion. A Lambda consumer that dispatches and returns would freeze
  the agent mid-run → the consumer must be a **long-running process** (Fargate),
  not Lambda.
- **Step Functions complements, doesn't host.** SFN Standard (up to 1yr, Wait
  states, retries, DLQ) is great for *discrete, predefined* long jobs — not the
  model-driven agent loop, which would become a miserable Lambda-per-turn Choice
  loop. Use it next to the actor, for explicit scheduled jobs only.
- **Verify before the queue.** Slack signs the raw body (API Gateway can't
  compute HMAC) and *retries* unacked deliveries. A bare API GW→SQS direct
  integration leaves the endpoint unauthenticated — anyone who finds the URL
  enqueues fake events, each spinning a Daytona box + burning Bedrock tokens. A
  ~10-line verify-Lambda closes that. (If you accept API GW→SQS direct, the
  consumer **must** verify after dequeue.)
- **Aurora for sessions, DynamoDB only for the lease.** Sessions are SQL-shaped
  and `@flue/postgres` exists; DDB would need a custom `PersistenceAdapter`. Keep
  DDB for the per-channel lease lock (conditional writes), where it shines.

## Idempotency (required, because we ack before finishing)

Slack retries deliveries it thinks failed, and we return `200` before the work
runs. So **every effect must be idempotent**: correlate on Slack `event_id`
(and/or Flue `dispatchId`) so a retried webhook does not double-run a task or
post a duplicate reply. FIFO dedup (`MessageDeduplicationId = event_id`) handles
the common case at the queue; the consumer should still guard terminal effects.

## What the shipped examples already give us

- **Slack channel** (`@flue/slack`): signature verification + dispatch keyed by
  thread — the verify-Lambda and the consumer's dispatch reuse this.
- **Per-thread Daytona sandbox** (`src/sandboxes/`): adapter + create/reuse/clean
  lifecycle keyed by id — carries straight over (channel id instead of thread).
- **Bedrock model wiring**, skills-in-the-sandbox discovery, the reply tool.

## Status / open questions

| Pillar | State |
|---|---|
| Durable per-channel memory (`db.ts` → Aurora) | ✅ **verified** viable |
| Single-writer per channel (FIFO / DDB lease) | ✅ **verified** on real AWS (consumer must use `MaxNumberOfMessages=1`) |
| Self-scheduling (EventBridge wake → re-enqueue) | ✅ **verified** on real AWS; **wired live into the agent** (`schedule_followup` tool) — agent scheduled itself, woke, and acted |
| Daytona adapter + per-channel lifecycle | ✅ **verified** against live Daytona (list-by-label is eventually consistent → relies on per-channel serialization) |
| **Pluggable sandbox providers** (daytona/ec2/k8s/saas, swap via env) | ✅ **verified LIVE** — `examples/assistant-slack-aws-daytona/src/sandbox/`; local + daytona both ran real turns; new backend = 9-method `SandboxApi` + 1 registry line |
| Long-loop checkpoint/resume shape | ✅ **verified** (local); checkpoint in `SessionData.metadata`, idempotent re-wake |
| **Full e2e: Slack→APIGW→SQS→Lambda→Bedrock→reply** | ✅ **verified LIVE** (real Slack + AWS + Bedrock) — `examples/assistant-slack-aws-daytona/` |
| Durable per-channel memory — **S3** (chosen), DynamoDB (alt) | ✅ **verified LIVE** — survives forced cold start (each 55/55 contract tests). S3 chosen for text-heavy channels (no size limit, ~11x cheaper, flat per-PUT). |
| Governance — per-channel scoping | ✅ **verified LIVE** — S3 `config/<channel>.json` → agent toolset; reply-only channel couldn't schedule. Spend caps + audit log still ☐ |

Open questions worth resolving before a full build:
- ~~Does the consumer drive a *keyed* instance to completion via a supported
  API, or does that require Flue internals?~~ **RESOLVED**:
  `flue run --id <channelId>` is the supported run-to-completion path and resumes
  durable per-channel memory — no internals. Consumer = `SQS msg → flue run --id
  <channelId> --input <turn>` (or the built server on Fargate).
- Cold-start-from-queue vs warm-minimal-task: pick by expected channel traffic.
- Where the long-loop checkpoint lives (Aurora session metadata vs a dedicated
  table) and what triggers the next EventBridge wake.

## Progress log

- **2026-06-26** — Spiked `db.ts` persistence: a
  per-channel session survives 3 separate processes on `sqlite()`. Confirmed
  `@flue/postgres` is official, so Aurora is a one-liner. Memory pillar holds.
- **2026-06-26** — Spiked single-writer on **real AWS**:
  SQS FIFO `MessageGroupId=channelId` serializes turns per channel (cross-channel
  parallel); DDB conditional-write lease gives single-owner for the long loop.
  Learning: FIFO batches multiple msgs of one group into a single `Receive` when
  `MaxNumberOfMessages>1` — consumer must use **`MaxNumberOfMessages=1`**.
  Resources torn down, none left behind.
- **2026-06-26** — Spiked self-scheduling on **real AWS**:
  an app-created EventBridge Scheduler one-shot
  `at(~90s)` schedule fired and delivered a synthetic turn into the per-channel
  FIFO queue (`MessageGroupId=channelId`) — scheduled wakes reuse the
  single-writer path. Learnings: IAM role assumability is eventually consistent
  (retry `CreateSchedule`); IAM `Description` is ASCII-only; FIFO target via
  Scheduler needs `ContentBasedDeduplication=true`; least-privilege role trusts
  only `scheduler.amazonaws.com` + `sqs:SendMessage` on the one queue. Resources
  torn down.
- **2026-06-26** — Spiked the Daytona adapter against the **live Daytona API**
  (importing the real example files): full SessionEnv
  round-trip (exec + fs) passes, ~420ms create. Found Daytona's list-by-label
  (and delete) are **eventually consistent** (~1-2s) → naive create-or-reuse can
  double-create under concurrency; closed by per-channel serialization (FIFO +
  lease). `provision.ts` now documents this. Boxes torn down, none left.
  Daytona API is public HTTPS, so Fargate egress == laptop egress (outbound 443).
- **2026-06-26** — Spiked long-loop checkpoint/resume (local
  Flue): a 4-stage task advanced one stage per process across 4 separate
  processes, resuming from a durable checkpoint stored in `SessionData.metadata`;
  a duplicate wake was an idempotent no-op. Confirms "pursue over days" = many
  short woken turns over a checkpoint (persistence + self-scheduling +
  single-writer composed), not a pinned process.
- **2026-06-26** — Spiked the consumer→keyed-agent slice
  (**real Bedrock**): `flue run --id <channelId>` drives a channel-keyed agent to
  completion and resumes durable per-channel memory across separate processes
  (turn 2 recalled turn 1; a different id did not) — the supported API, no Flue
  internals. Resolved the last open integration question. Learning: `db.ts` must
  live in the **source root** (`src/` if present), not the project root, or it's
  silently ignored (state stays in-memory). **All mechanism + design pillars
  verified; the consumer path is proven against real models.**
- **2026-06-29** — **Full end-to-end verified LIVE** (`examples/assistant-slack-aws-daytona/`): a real
  Slack `@mention` flowed Slack → API Gateway → verify-Lambda (HMAC) → SQS FIFO
  → consumer container Lambda → `flue run --id <channelKey>` → Bedrock →
  `reply_in_slack` → reply posted in the Slack thread. ~6s warm / ~38s cold.
  Extra wiring lessons: Lambda Node RIC doesn't type-strip a `.ts` entrypoint
  (transpile handler.ts→.mjs with esbuild); `@flue/cli` must be a prod dep;
  SQS visibility = consumer max (900s); Lambdas cache secrets per warm
  container (bounce after change). **The architecture is proven end to end.**
  *Next:* governance/product layer (per-channel tool & permission scoping, spend
  caps, audit log); productionize persistence (`@flue/postgres`→Aurora) and
  sandbox (Daytona). Then **tear down** the live `slack-e2e-*` resources.
- **2026-06-29** — Productionized persistence on **DynamoDB, not Aurora**
  (`examples/assistant-slack-aws-daytona/src/dynamo-adapter.ts`). Custom
  PersistenceAdapter swaps only `executionStore.sessions` for DynamoDB, keeps
  the rest in-memory (sound for the one-shot `flue run` consumer). Passes Flue's
  55-test contract suite; **verified live: recalled a fact across a forced cold
  start** (which `/tmp` SQLite couldn't). **Decision update:** for this
  serverless deployment DynamoDB beats Aurora — no VPC/NAT, ~zero idle — at the
  cost of a custom adapter (now written + contract-tested). Aurora remains the
  choice only if you need SQL/relational access to session data. Contract suite
  caught two prod-relevant DynamoDB limits: 400KB item (chunk JSON) and 1MB
  Query page (paginate).
- **2026-06-29** — Swapped session storage to **S3**
  (`examples/assistant-slack-aws-daytona/src/s3-adapter.ts`) because channels hold a lot of text and
  Flue rewrites the whole conversation each turn — DynamoDB's per-KB writes +
  400KB chunking scale badly; S3 has no size limit, flat per-PUT cost, ~11x
  cheaper storage, and FIFO already gives the single-writer guarantee DynamoDB's
  conditional writes would. Adapter is simpler (one object/session, no
  chunking/pagination); passes Flue's 55 contract tests; **verified live:
  cold-start recall from S3**. IAM needs `s3:ListBucket` on the bucket arn in
  addition to object actions. `db.ts` now prefers SESSIONS_BUCKET > SESSIONS_TABLE
  > local sqlite.
- **2026-06-29** — **Self-scheduling wired into the live agent**
  (`examples/assistant-slack-aws-daytona/src/tools/schedule.ts`): a `schedule_followup` tool creates a
  one-shot EventBridge schedule → FIFO wake → same channel-keyed agent acts.
  Verified end to end (agent scheduled itself, woke ~1 min later, acted on its
  note). Needed a scheduler-target IAM role (consumer `iam:PassRole` +
  `scheduler:CreateSchedule`) and — the catch — `ContentBasedDeduplication=true`
  on the FIFO queue, because EventBridge's SQS target sets no dedup id and the
  queue silently rejected the send otherwise.
- **2026-06-29** — **Pluggable sandbox providers** (`examples/assistant-slack-aws-daytona/src/sandbox/`).
  The agent talks to a `SandboxProvider.forChannel(id)` interface, never a
  concrete backend; `SANDBOX_PROVIDER` env selects local/daytona/ec2-ssm/…
  (default local). Enabler: Flue's `SandboxApi` is the seam — any backend (EC2
  via SSM/SSH, k8s pod via connectExec, Fargate, SaaS) is 9 methods + 1 registry
  line. Verified live: local ran a turn; daytona ran a real shell command in a
  per-channel box (`SANDBOX-DAYTONA-Linux-42`). Live Lambda still defaults to
  `local`; prod switch = set SANDBOX_PROVIDER + DAYTONA_API_KEY.
- **2026-06-29** — Governance pt.1: **per-channel scoping**
  (`examples/assistant-slack-aws-daytona/src/governance/channel-config.ts`). Admin puts
  `config/<channel>.json` in the sessions bucket (`{tools, model?,
  maxTokensPerTurn?}`); consumer loads it at turn start and passes
  CHANNEL_TOOLS/CHANNEL_MODEL to the agent, which builds its toolset from the
  allowlist — a disallowed tool is genuinely absent, not just declined. Verified
  live (reply-only channel couldn't schedule). Consumer v8. *Next (governance):*
  spend caps (parse `flue run` usage.cost → per-channel/org counters) and an
  audit log of who-asked-what.
