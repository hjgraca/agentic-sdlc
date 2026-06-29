---
name: create-agent
description: >-
  Procedure for adding a new agent example to this repo. Use when the user asks
  to "create an agent", "create another agent", "build a bot", "add an agent that
  …", "create a GitHub/Jira/Slack bot", or otherwise wants a new autonomous-agent
  reference architecture under examples/. Covers the full build: trigger choice,
  ecosystem check, wiring, skill, tools, deploy, validation, and dogfooding.
---

# Creating a new agent example

You are adding a new Flue agent reference architecture to this repo. Each one is
a complete, independently-clonable app under `examples/`. Follow this procedure;
it encodes conventions and hard-won lessons that are easy to get wrong.

/ The human-facing walkthrough is [docs/creating-an-agent.md](../../../docs/creating-an-agent.md).
/ This skill is the agent-facing checklist — terser, with the gotchas.

## 0. Read these first (do not skip)

- [AGENTS.md](../../../AGENTS.md) — repo conventions. The non-negotiables below
  come from it.
- The closest existing example under `examples/` — copy its shape rather than
  inventing one. Current examples: `triage-jira-k8s` (webhook→server),
  `triage-jira-gitlab-runner` (CI one-shot), `triage-github-actions` (Actions
  one-shot), `github-pr-label-actions` (Actions, label-triggered, takes write
  actions).

## 1. CHECK THE FLUE ECOSYSTEM BEFORE WRITING ANYTHING

This is the most common mistake — do not hand-roll what Flue already ships.

- Channels & official tools: check
  `https://flueframework.com/docs/ecosystem/channels/<provider>/` and the
  provider package (e.g. `@flue/github` → `createGitHubChannel` + an
  Octokit-backed tool). Scaffold with `flue add channel <provider>` where it
  exists.
- Deploy: check `https://flueframework.com/docs/ecosystem/deploy/<target>/` for
  the canonical workflow/manifest and copy its shape.
- These are **public** docs — fetch with **WebFetch**, NOT the internal
  ReadInternalWebsites tool.
- Only build a custom channel/tool when the ecosystem genuinely lacks one, and
  say so explicitly in the example. When you use a provider SDK directly, prefer
  the same client the matching Flue channel uses (e.g. `@octokit/rest`).

## 2. Decide the trigger — it determines the deploy

Trigger and deploy are NOT independent knobs (AGENTS.md "Trigger drives deploy"):

- **Webhook** → long-running server + a Flue **channel** (`src/channels/…`) →
  k8s / VM. Real-time. (`triage-jira-k8s`.)
- **CI / platform event** (issue labelled, PR opened, pipeline trigger) →
  **one-shot `flue run`, NO channel** → a runner (GitHub Actions, GitLab CI).
  The workflow IS the trigger; input arrives as a CLI `--input`.
  (`triage-github-actions`, `github-pr-label-actions`.)

"Same agent on a different deploy" is a NEW example, not a config switch.

## 3. Confirm scope with the user before building

Ask only what you can't safely infer. Always pin down:

- **Naming** `<function>-<primary-stack>` (folder is just a handle; discovery is
  the root README table). Generic agents name the function, not one skill.
- **Trigger + deploy** (from step 2).
- **Any irreversible / outward-facing action** the agent will take (merge,
  comment, post, delete). For these, confirm the exact safety mechanism — e.g.
  enable auto-merge so required checks gate it, rather than an immediate merge.
- **Policy that needs human judgement** ("low-risk", "spam", "urgent"): that
  belongs in the **skill** as bounded limits the model judges within — never
  hardcoded in the agent.

## 4. Build the four pieces (+ tests)

Mirror the closest example. The shape is always:

1. **Agent** `src/agents/<name>.ts` — pure wiring: `model`, `sandbox`, `tools`.
   NO prose, NO instructions field.
   - Model: default `amazon-bedrock/us.anthropic.claude-sonnet-4-6` (this repo's
     provider is Bedrock — do NOT default to `anthropic/` + `ANTHROPIC_API_KEY`).
   - `const cwd = process.env.SKILLS_DIR ?? process.cwd();` then
     `sandbox: local({ cwd })` so skills are discoverable and overridable.
   - `tools: Object.values(xTools)` (it already returns a fresh array — don't
     spread-clone it; for several modules use `[...Object.values(a), ...Object.values(b)]`).
     The tool module must export ONLY tools — put pure helpers in a separate
     `helpers.ts` (a non-tool export here becomes a bogus tool; `tsc` will catch it).
2. **AGENTS.md** — one or two lines of always-on framing ("You do X. Use the
   <skill> skill.").
3. **Skill** `.agents/skills/<name>/SKILL.md` — frontmatter (`name`,
   `description`) + the step-by-step procedure. Judgement policy and limits live
   here; put a decision checklist in `references/`. Skills are discovered at
   runtime — no imports, editable without a rebuild.
4. **Tools** `src/tools/<provider>/<provider>.ts` — outbound API calls via
   `defineTool`, credentials from `process.env` at call time, never hardcoded.
   Each `run` should `try/catch` and return a clear error string.
   - **Inbound = channel, outbound = tool.** A provider you receive from is a
     channel; one you only call is tools.
5. **Tests** — extract pure logic into `helpers.ts` and cover it with
   `node:test` (no new deps): add a `test` script
   `node --test --experimental-strip-types "src/**/*.test.ts"`. Add the example
   to the `matrix.example` list in `.github/workflows/ci.yml`.

## 5. Wire trigger + deploy

- **Actions one-shot:** `.github/workflows/<name>.yml`. Gate the job tightly
  (`if:` on the exact label/actor). Bedrock auth via **GitHub OIDC** (assume a
  Bedrock-only role; no stored AWS keys) — see
  [docs/github-actions-bedrock-oidc.md](../../../docs/github-actions-bedrock-oidc.md).
  Pass workflow context through `env:` and build the `--input` in-shell; never
  interpolate `${{ github.event.* }}` into a `run:` string (injection).
- If the agent needs a write token on PRs from bots/forks, use
  `pull_request_target` but **never check out or run the PR's code** — API only.
- **Webhook server:** `src/channels/<provider>.ts` (verify + dispatch) + a k8s
  or VM deploy. Readiness probe must be TCP, not HTTP (Flue serves no `GET /`).

## 6. Validate, then dogfood

Run all three from the example dir and confirm green:

```
./node_modules/.bin/flue build --target node
./node_modules/.bin/tsc --noEmit
npm test
```

(Run the CLI as `./node_modules/.bin/flue` — `npx flue` resolves to an unrelated
package.) Then, if possible, trigger it end-to-end on a real event and read the
run log + the side effect (comment / merge / label) to confirm behavior — that
is the only true test of an agent.

## 7. Keep docs in sync

- Add a row to the root [README.md](../../../README.md) examples table
  (providers/trigger/deploy are columns, not the folder name).
- Update the example's own README (include a mermaid of the flow, like the
  siblings).
- Never commit secrets, account ids, ARNs, org URLs, or live hostnames — only
  `.example` placeholders. Scan the staged diff before committing.

## Provenance of these rules

The ecosystem-first check (step 1) and the Bedrock default (step 4) are recorded
as repo memory because they were repeated corrections. The helpers-vs-tools
split (step 4) and the injection-safe workflow pattern (step 5) came from real
`tsc` errors and security-hook catches while building the existing examples.
