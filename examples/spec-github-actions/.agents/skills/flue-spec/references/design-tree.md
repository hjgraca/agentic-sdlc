# Design tree for a new Flue example

The recurring decisions to resolve when speccing a new example, in dependency
order. Walk them **one branch at a time**, batching only tightly-related
sub-decisions into a single interview comment. For each, recommend an answer
grounded in the blueprint / package source / closest existing example. Later
branches depend on earlier ones — resolve top-down.

## 1. Trigger → deploy (resolve FIRST; it determines almost everything)
This repo's iron rule: **trigger drives deploy**. They are not independent.
- **Webhook** (real-time, receive events) → long-running server + a Flue
  **channel** (`src/channels/…`) → k8s / VM / container host.
- **CI / platform event or schedule** (issue/PR labelled, pipeline trigger,
  cron) → **one-shot `flue run`, NO channel** → a runner (GitHub Actions, GitLab
  CI). The workflow IS the trigger; input arrives via `--input`.
Decide which, and the concrete deploy target, before anything else.

## 2. Work source & code host
What system does the work arrive from (Jira/Linear/GitHub/Slack/…), and where
does any code it touches live? These become README-table columns and pick the
channel/tools.

## 3. Channel vs tools (inbound vs outbound)
- A provider you **receive** from → a **channel** (verify + dispatch). Only when
  the trigger is a webhook.
- A provider you only **call** → **tools** under `src/tools/<provider>/`.
Check the blueprint: does Flue ship a channel/tool for this provider
(`@flue/<x>`)? If so, use it — don't hand-roll.

## 4. Which `@flue/*` packages
From the blueprint + `context/flue/packages/`, the exact packages and any
provider SDK (e.g. `@linear/sdk`) to depend on, pinned. Note version constraints
the blueprint calls out (e.g. `nodejs_compat` for Cloudflare).

## 5. Model & provider
Default `amazon-bedrock/us.anthropic.claude-sonnet-4-6` (this repo's Bedrock/OIDC
convention). Only diverge with a specific reason.

## 6. Sandbox
Does the agent need a real sandbox (runs code / shell) or just `local()`? If a
remote sandbox, which provider (blueprint `sandbox--*`) and how is it
provisioned?

## 7. Skill shape
What procedure does the agent follow (the skill), and what judgement policy /
limits belong in it (never hardcoded in the agent)? Any `references/`.

## 8. Secrets & config
What credentials at runtime (env-only), and what account-specific values need an
overlay/`.example` file. Never committed.

## 9. Tests
What pure logic to extract into `helpers.ts` and cover with `node:test`.

## 10. Deploy specifics
Workflow/manifest details: gating (`if:` on the exact label/actor), OIDC→Bedrock
vs other creds, readiness probe (TCP for webhook servers), concurrency.
