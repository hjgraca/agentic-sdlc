# Spec preferences — standing rules (the agent's memory)

The spec agent reads this every run and treats each rule as a **hard
constraint** on the spec it produces. These are **durable org policies** — not
per-spec choices (those live in the discussion thread).

**Editing:** this is the agent's memory. Edit it for your org. Prefer changing it
through the learning-capture flow (a `spec-learning` issue → `approved-learning`
label → an auto-opened PR → human merge), so every change is reviewed and the
git history is the audit log of what the agent learned and when. Direct edits are
fine too.

> The rules below marked _(example)_ are placeholders for a fresh clone — replace
> them with your own. The rules without that marker are this repository's real
> policy.

## Infrastructure

- **For any infrastructure or deploy target, use AWS services. Do NOT propose
  Cloudflare** (Workers, D1, R2, KV, Durable Objects, etc.). If a Flue blueprint
  targets Cloudflare (e.g. `channel--linear.md`'s Cloudflare Worker example),
  adapt the deploy to an AWS equivalent (Lambda, ECS/Fargate, API Gateway, SQS,
  DynamoDB, S3) and say so in the spec.

## Sandboxes

- **Use only Flue-supported sandboxes; do NOT use the Cloudflare sandbox**
  (Durable Objects / `@cloudflare/sandbox`). **Default to Daytona.** Deviate from
  Daytona only when the agent's workload has a specific reason — e.g. a pure
  read-and-reply triage agent that runs no code can use `local()` — and document
  that reason explicitly in the spec.

## Models

- Default to `amazon-bedrock/us.anthropic.claude-sonnet-4-6` (this repo's
  Bedrock/OIDC convention) unless a spec has a specific reason to differ.

## Concurrency & Ordering

- For any single-writer-per-key ordering requirement, use **AWS FIFO SQS** (with
  a **DynamoDB lease**) rather than hand-rolled locking mechanisms.

## Documentation

- **The spec must include a deployment/testing section that is a followable
  runbook, not prose.** Specify it as tiers: **Tier 1 — offline** (no external
  accounts) with the exact build/typecheck/test commands plus how to boot the app
  and assert its ingress/auth behaves (e.g. an unauthenticated request returns
  401 — the rejection *is* the passing check); **Tier 2 — real end-to-end** with
  the concrete provider/deploy steps (registration → the specific secrets it
  yields → wiring → how to trigger the first real event). Include an **honest
  ceiling statement**: what genuinely cannot be verified without live infra, so a
  reader never chases an impossible local shortcut. Do not describe a multi-step
  external setup (e.g. "register a bot in the cloud console") as if it were a
  single step.

## Conventions

- _(example)_ Prefer the deploy shape of the closest existing example over
  inventing a new one; call out any divergence explicitly.

<!--
Add new rules as short, imperative bullets under a clear heading. Keep each rule
general (it should apply to future specs), specific enough to act on, and
non-contradictory with the others. One rule per bullet.
-->
