# Spec-match checklist — does the PR build what the spec agreed to?

Walk these against the linked spec issue's body and the PR diff. Each item is
either satisfied, a discrepancy (→ list it in REQUEST_CHANGES), or not-applicable
(the spec is silent — not a discrepancy). Judge substance, not wording.

## The four pieces exist and match the spec
- [ ] **Agent** `src/agents/<name>.ts` — present, and pure wiring only
      (`model`, `sandbox`, `tools`; no prose, no `instructions` field). The
      model matches the spec (default `amazon-bedrock/us.anthropic.claude-sonnet-4-6`).
- [ ] **Channel vs tools matches the trigger** — inbound provider = a channel
      (`src/channels/`); outbound-only = tools (`src/tools/<provider>/`). A
      webhook spec must have a channel; a CI/event one-shot must NOT (the
      workflow is the trigger). Tool modules export only tools; pure logic is in
      `helpers.ts`.
- [ ] **Skill** `.agents/skills/<name>/SKILL.md` — present with the procedure the
      spec describes, plus any `references/` the spec calls for.
- [ ] **Deploy** — the workflow/manifest the spec specifies (the right target:
      Actions / k8s / Lambda / GitLab CI …), not a different one.

## The wiring matches the spec's SPECIFIC choices
- [ ] Exact `@flue/*` packages the spec names (channel/tool/deploy packages).
- [ ] Trigger matches (label name, webhook event, cron, …) and is gated as the
      spec requires (e.g. author/permission checks for world-writable triggers).
- [ ] Deploy target matches (the spec's infra decision — e.g. AWS not
      Cloudflare, if the spec says so).
- [ ] Any decision the spec explicitly made is honored — queue type (FIFO vs
      standard), sandbox (Daytona vs local), persistence backend, concurrency
      model. **A silent departure from a called-out decision is the most
      important kind of discrepancy.**

## Verified & wired
- [ ] The pure logic the spec's test plan identifies is extracted to
      `helpers.ts` and covered by `node:test` (the CI job runs it; you confirm it
      EXISTS and covers what the spec asked for).
- [ ] Added to CI: an entry in `.github/ci-examples.json`.
- [ ] A row added to the root `README.md` examples table.
- [ ] The example's own `README.md` is present and describes the built shape.

## Safe & scoped
- [ ] No secrets, account-ids, ARNs, org URLs, or live hostnames — only
      `.example` placeholders.
- [ ] The diff touches only the new `examples/<name>/` plus the two wiring edits.
      Unrelated files, other examples, or `.github/workflows/` edits are a red
      flag — call them out.

## Deciding the verdict
- **All satisfied (spec-silent items aside)** → `matches` / APPROVE.
- **Any real discrepancy** → `changes-requested` / REQUEST_CHANGES, each listed
  as `spec says X → PR does Y (file)`.
- **Couldn't validate** (no linked spec, diff unreadable) → `uncertain` /
  COMMENT, saying what's missing. Never let uncertainty read as a pass.
