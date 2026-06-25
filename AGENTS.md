# Working in this repository

Guidance for AI coding agents (and humans) making changes here. This is the
**repo-level** AGENTS.md — distinct from the `AGENTS.md` *inside each example*,
which is a [Flue](https://flueframework.com) agent's system-prompt framing
discovered at runtime. Don't conflate the two.

## What this repo is

A collection of **Flue agent reference architectures**. Each folder under
`examples/` is a complete, independently-clonable Flue app. See the root
[README.md](README.md) for the example index and
[docs/adding-skills.md](docs/adding-skills.md) for the skills guide.

## Repository conventions

- **Examples are self-contained.** Each `examples/*` is a full app (own
  `package.json`, skills, tools, deploy). No cross-example imports, no shared
  workspace. Duplication between examples is acceptable — clone-one-folder is the
  point.
- **Naming: `<function>-<primary-stack>`** (e.g. `triage-jira-k8s`,
  `build-gitlab`, `review-github`). The folder name is a unique handle keyed on
  the work source; if two examples share that key (e.g. two Jira triagers on
  different deploys), append the deploy: `triage-jira-k8s` vs
  `triage-jira-gitlab-runner`. **Discovery happens via the README table**, not
  the name. Providers and deploy
  are columns there, not in the path.
- **Each example is pinned to one trigger + one deploy.** "Same agent on a
  different deploy/stack" is a *new example*, not a config switch — because the
  trigger model determines the deploy (see next point).
- **Trigger drives deploy.** Webhook ⇒ long-running server ⇒ k8s/VM (uses a
  channel). CI event ⇒ one-shot `flue run` ⇒ runner (no channel). They are not
  independent knobs.

## Flue app conventions (inside each example)

- **Inbound is a channel, outbound is a tool.** A provider you *receive* webhooks
  from → `src/channels/<provider>.ts` (verify + dispatch, never calls out). A
  provider you only *call* → `src/tools/<provider>/`. A provider can be both.
- **The agent file is pure wiring.** `src/agents/<name>.ts` declares model +
  sandbox + tools only. No instruction prose. The agent's framing lives in
  `AGENTS.md`; its procedure lives in a skill.
- **Skills are discovered, not bundled.** Flue reads `AGENTS.md` and
  `.agents/skills/<name>/SKILL.md` from the sandbox cwd at `init()`, and rereads a
  skill on each activation. Do **not** use `import … with { type: 'skill' }`.
  The sandbox cwd is `process.env.SKILLS_DIR ?? process.cwd()` so production can
  mount a different skill set without rebuilding. See
  [docs/adding-skills.md](docs/adding-skills.md).
- **Tools are grouped per provider** under `src/tools/<provider>/`. Import tool
  modules directly; no barrel `index.ts` files.
- **No workflows unless something consumes the result.** These agents are
  fire-and-forget (the output is a side effect — a comment, an MR). Add a Flue
  workflow only if a downstream consumer needs the structured return value.

## Model & provider (configurable per example — not fixed)

The LLM is **not** part of an example's identity; it's a one-line choice. The
agent's `model:` field is a Flue **model specifier** — `<providerId>/<modelId>`:

```ts
model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',  // triage-jira-k8s's choice
// e.g. also: 'anthropic/claude-sonnet-4-6' · 'openai/gpt-5.5'
//            'openrouter/moonshotai/kimi-k2.6'
```

- Flue uses [Pi](https://pi.dev/docs/latest/providers)'s catalog-backed
  providers. For a **built-in** provider you do **not** register anything in
  code — just pick a supported specifier and make its credential available at
  runtime. By provider id → env var:

  | Provider id | Credential |
  |---|---|
  | `anthropic` | `ANTHROPIC_API_KEY` |
  | `openai` | `OPENAI_API_KEY` |
  | `openrouter` | `OPENROUTER_API_KEY` |
  | `amazon-bedrock` | AWS credentials (`AWS_PROFILE` locally / IRSA in-cluster) + `AWS_REGION` |
  | `cloudflare` | Worker `AI` binding |

- **`triage-jira-k8s` uses `amazon-bedrock` only because that's what the workshop
  cluster provides** (Bedrock via IRSA, `us.` profile — see gotchas). To run it
  on Anthropic instead: change the specifier to `anthropic/claude-sonnet-4-6` and
  set `ANTHROPIC_API_KEY`. Nothing else changes.
- Credentials follow the same env-only rule as all secrets (below) — never in
  code or committed config.
- For a provider **not** in Pi's catalog (self-hosted, a gateway, custom
  transport), register it at runtime with `registerProvider` /
  `registerApiProvider` (exported from `@flue/runtime`) — see Flue's Provider API
  docs. Built-in providers never need this.

## Hard-won gotchas (verified on a real cluster — don't relearn these)

- **`npx flue` resolves to an unrelated public npm package named `flue`.** Always
  run the project CLI as `./node_modules/.bin/flue`.
- **Bedrock model must match the IAM policy.** A policy scoped to the `us.`
  inference profile (`amazon-bedrock/us.anthropic.claude-sonnet-4-6`) denies the
  `global.` one. In-cluster auth is IRSA, not a secret. (Model is configurable —
  see "Model & provider".)
- **Build images for `linux/amd64`** (`docker build --platform linux/amd64`) —
  EKS nodes are amd64; an Apple-Silicon build fails with `exec format error`.
- **Use a fresh immutable image tag every deploy** (`:v1`, `:v2`, …). Reusing a
  tag leaves nodes serving the cached old image.
- **Readiness probe must be TCP, not HTTP.** Flue serves no `GET /` route (404s),
  so an httpGet probe never passes and the Service gets no endpoints.
- **The NLB is locked to a CloudFront-origin prefix-list.** External callers
  reach it via a CloudFront distribution, not the NLB directly. In-cluster works
  because it bypasses the security group.

## Secrets & git hygiene

- **Never commit secrets.** `.env` is gitignored; before committing, scan the
  staged diff for token patterns (`ATATT3x…`, `glpat-…`, `sk-ant-…`, `AKIA…`).
- **`context/` is local only** — it holds cloned upstream repos for reference and
  is gitignored; never commit it.
- Secrets come from the environment at runtime (local `.env`, k8s Secret, CI
  masked variable, cloud IAM) — never hardcoded in code or committed config.
  Example files (`.env.example`, `k8s/base/secret.example.yaml`) carry
  placeholders only.
- **Account-specific (non-secret) deploy values use a Kustomize overlay, not
  hand-edits.** `k8s/base/` is generic + committed; real registry/IAM-ARN/org
  values go in `k8s/local/kustomization.yaml` (gitignored). Customers
  `cp kustomization.example.yaml kustomization.yaml`, fill it in, and
  `kubectl apply -k k8s/local/`. Never commit account ids, role ARNs, ECR paths,
  org URLs, or live hostnames.
- Pin dependencies to concrete versions; do not use `"latest"`.
- Use `git mv` for moves/renames so history is preserved.

## Before you finish a change

1. Build the affected example: `cd examples/<name> && ./node_modules/.bin/flue build --target node`.
2. For channel changes, smoke-test the webhook (valid → 200, wrong secret → 401).
3. Keep docs in sync: the root README table, `docs/`, and each example's README.
