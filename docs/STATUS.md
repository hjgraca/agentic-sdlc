# Status — where this stands & what's next

A pause point. Everything below is **built, verified, and documented**; nothing
is half-done. The system runs and the next steps are small, optional, and each
sits behind a clean seam — so you can resume in any direction with no relearning.

## What this is

A Claude-Tag-style Slack agent ("@-mention a teammate") built on
[Flue](https://flueframework.com), from clone-able examples through a fully-wired,
live-verified AWS deployment. Full design + decision log:
[aws-claude-tag-architecture.md](aws-claude-tag-architecture.md).

## What works (verified live: real Slack + AWS + Bedrock)

- **End-to-end pipeline**: Slack @mention → API Gateway → verify-Lambda (HMAC) →
  SQS FIFO (one writer per channel) → container consumer (`flue run --id`) →
  Bedrock → reply in thread. Code: [`e2e/slack-aws/`](../e2e/slack-aws/).
- **Per-channel memory** (Claude Tag's "one Claude per channel"), durable on **S3**
  (chosen over DynamoDB for text-heavy channels; both adapters pass Flue's 55-test
  contract suite). Survives cold starts.
- **👀 on pickup** — reacts the instant a worker takes the message.
- **Self-scheduling** — the agent can wake itself later via EventBridge ("follow
  up in 6h"); the wake re-enters through the same per-channel path.
- **Pluggable sandbox** — `SANDBOX_PROVIDER` swaps local / Daytona / (ec2/k8s/SaaS
  stub); a new backend = Flue's 9-method `SandboxApi` + one registry line.
- **Governance — per-channel scoping** — an S3 `config/<channel>.json` restricts a
  channel's tools/model; a disallowed tool is genuinely absent. (See "open
  question" below.)

Seven throwaway spikes under [`spikes/`](../spikes/) each de-risked one mechanism
(persistence, single-writer, self-scheduling, the Daytona adapter, long-loop
checkpoint, the consumer→keyed-agent path, the S3/DynamoDB adapters).

## Open question (deliberately unresolved)

**Who creates the per-channel config, and when?** Channel IDs don't exist until a
channel is used, so config can't be pre-authored by ID. The scoping *hook* works
and defaults safely (no config → all tools), but the *authoring/bootstrapping*
policy is undecided. Resolve it the day you actually need two channels to differ
— options, with the trigger that makes each right:

- Few channels, you're the only admin → edit the S3 object by hand. (Today.)
- Non-technical admins → a `/claude-config` Slack slash command (no IDs, in-Slack).
- One workspace-wide policy → add a `config/_default.json` team-default fallback.
- Approvals / versioning / multi-app → external store (AppConfig/SSM/DynamoDB)
  behind the same `loadChannelConfig` seam.

## Natural next steps (each small, optional, behind a seam)

- **Audit log** — append who-asked-what + tokens/cost/tools per turn (useful even
  with one channel; lowest risk).
- **Spend caps** — parse the per-turn `usage.cost` Flue already returns → per-channel
  / org budgets.
- **Flip on Daytona in prod** — set `SANDBOX_PROVIDER=daytona` + `DAYTONA_API_KEY`.
- **Productionize config authoring** — only once the open question above resolves.
- **Tear down** — live `slack-e2e-*` AWS resources + the Slack app; inventory in
  `e2e/slack-aws/.aws-resources.env` (gitignored). Rotate the Slack tokens after.

## Live resources (running)

The AWS stack and Slack app are **left running** so the bot can be used — that's
the best way to discover what's actually needed next. Teardown inventory is in
`e2e/slack-aws/.aws-resources.env` (gitignored; never committed).
