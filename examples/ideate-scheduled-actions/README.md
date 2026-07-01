# ideate-scheduled-actions — scheduled backlog ideation on GitHub Actions

> One of the [Flue Agent Reference Architectures](../../README.md). See
> [AGENTS.md](../../AGENTS.md) for the shared patterns and
> [docs/adding-skills.md](../../docs/adding-skills.md) for adding your own skills.

This is the repo's **first scheduled example**. On an hourly cron, the agent runs
**one-shot on a GitHub-hosted runner** (`flue run`), surveys this repo's example
matrix against what Flue actually offers — its blueprints, `@flue/*` packages,
and docs — and, when it finds a genuinely new high-value gap, opens **one**
GitHub **Discussion** in the **"Ideas" category** proposing what to build or fix
next. Most hours it finds nothing new and **opens zero discussions** — that is
the healthy default, not a failure.

Ideas are **Discussions, not issues**: an idea's whole pre-implementation life —
this proposal, a spec interview, human iteration — lives in that one discussion
thread. This example only *opens* the discussion; the spec agent and humans take
it from there.

It is the scheduled counterpart to
[`triage-github-actions`](../triage-github-actions/): same one-shot
Actions/`flue run`/OIDC→Bedrock shape, but the **trigger is a clock**, not a
label.

## Why no channel — and why a clock instead of an event

Flue ships official **channels** for the webhook→server path. This example
deliberately takes the **other** path, like the other Actions examples: a
GitHub-hosted runner is a one-shot CI executor with no always-on listener, so
there is no Flue channel here. **GitHub Actions itself is the trigger** — but
where the other Actions examples are triggered by an issue/PR event, this one is
triggered by `on: schedule` (cron). (Scheduled triggers aren't in Flue's
GitHub-Actions guide yet; the rest of the shape — `flue run`, OIDC→Bedrock,
typed tools — is the documented pattern.)

```
Hourly cron tick (on: schedule)
  → GitHub-hosted runner (singleton via concurrency group)
  → npm ci → shallow-clone Flue's repo into context/flue → flue run flue-ideation
  → agent lists "Ideas" discussions (its memory); if at cap (5 open) → exit cheap
  → else: reads the example matrix + context/flue (blueprints, docs, packages) — all local
  → finds the highest-value gap, dedups vs open AND closed ideas
  → opens at most ONE discussion in "Ideas" (or none) → exits
```

```mermaid
flowchart LR
    Cron["Hourly cron<br/>(on: schedule)"]
    Manual["workflow_dispatch<br/>(manual/test)"]

    subgraph runner["GitHub-hosted runner (one-shot, singleton)"]
        Before["checkout · setup-node · npm ci<br/>OIDC → assume Bedrock role<br/>git clone Flue → context/flue<br/>skills add -a universal (if SKILLS_REPO)"]
        Run["flue run flue-ideation"]
        Agent["flue-ideation agent<br/>(model + local sandbox + tools)"]
        CWD[("cwd / SKILLS_DIR<br/>AGENTS.md + .agents/skills/")]
        Before -->|writes| CWD
        CWD -.->|"framing + procedure<br/>discovered at init()"| Agent
        Before --> Run --> Agent
    end

    Mem['"Ideas" discussions<br/>(open=proposed,<br/>closed=rejected) — the memory']
    Flue[("context/flue (cloned)<br/>blueprints · docs · packages<br/>+ this checkout's matrix")]
    Bedrock["AWS Bedrock<br/>claude-sonnet-4-6"]
    Disc['New idea Discussion<br/>in "Ideas" (≤ one per run)']

    Cron --> Before
    Manual --> Before
    Agent -->|github_list_idea_discussions| Mem
    Agent -->|grep / read| Flue
    Agent --> Bedrock
    Agent -->|github_create_idea_discussion| Disc
```

## What it reads and writes

- **Reads (no token, all local files):** this checkout's example matrix
  (`README.md` table, each `examples/*`) and **Flue's repo cloned into
  `context/flue`** — its live `blueprints/` (the primary coverage-gap source),
  `apps/docs/` (the guide + CLI docs), and `packages/` (the `@flue/*` source),
  alongside the pinned `node_modules/@flue/*`. The workflow clones Flue before
  the run; the agent only `grep`/`read`s. No fetch tool, no pinned snapshot.
- **Writes (typed tool):** lists and opens idea Discussions in the "Ideas"
  category via Octokit's GraphQL API (`github_list_idea_discussions`,
  `github_create_idea_discussion`) — Discussions have no REST API.

## The idea charter

The agent stays inside a tight charter (full text in the skill):

- **Coverage gap** — Flue ships a capability no example uses.
- **Doc/example mismatch** — docs describe a pattern no example shows, or an
  example contradicts the docs.
- **Drift** — installed `@flue/*` exposes an API/pattern the examples don't use.

Out of charter: freeform product ideas and lint nits.

## Memory, cap, and discipline

- **The "Ideas" discussion category is the agent's whole memory.** Open
  discussion = already proposed; **closed discussion = a human rejected it, never
  re-propose.** No external state store, so the example stays pure-GitHub.
- **Cap: 5 open ideas.** At the cap the agent exits cheaply (one API call, near
  zero model cost) before any survey.
- **One discussion per run, max.** Even below the cap, it opens only its single
  best idea per hour.

## The hand-off to spec (human-gated)

Humans discuss the idea in the thread. When ready, a permission-holding human
@-mentions the spec agent (`@flue-spec`) in the discussion to start a spec
interview; that agent (a separate example) takes it from there. The ideation
agent never invokes the spec agent itself — the human is the quality gate.
Auto-chaining ideate → spec is an explicit non-goal.

## Setup

1. **Create an open-ended "Ideas" discussion category** (one-time; the API
   creates discussions, not categories). In the repo: **Settings → General →
   Features → Discussions** (enable), then **Discussions → categories → New
   category** named `Ideas`, format **Open-ended discussion**. The agent resolves
   the category by name at runtime, so no ID goes in config.
2. **Bedrock via OIDC** — set repository variables `AWS_ROLE_ARN` (a Bedrock-only
   role whose trust policy allows this repo's OIDC subject) and `AWS_REGION`. See
   [docs/github-actions-bedrock-oidc.md](../../docs/github-actions-bedrock-oidc.md).
3. **Enable the workflow** — it runs hourly once on the default branch. Trigger a
   test run from the Actions tab (`workflow_dispatch`).
4. *(Optional)* set `SKILLS_REPO` to load the skill from its own repo on a
   separate release cycle.

## Run it locally

```bash
cp .env.example .env   # set AWS_PROFILE, AWS_REGION, GITHUB_TOKEN, GITHUB_REPOSITORY
npm ci
npm test               # unit tests for the pure helpers
# Clone Flue so the agent has its live blueprints/docs/packages on disk (CI does
# this for you). Skip it and the skill falls back to node_modules/@flue/* only.
git clone --depth 1 --filter=blob:none https://github.com/withastro/flue.git context/flue
./node_modules/.bin/flue run flue-ideation \
  --input '{"message":"Run scheduled ideation over this repo."}'
```

Cadence is the cost/noise dial: edit the `cron:` in
[.github/workflows/ideate.yml](.github/workflows/ideate.yml) (`0 */4 * * *` for
every four hours, etc.). GitHub disables scheduled workflows after 60 days of
repo inactivity.

## Layout

```
ideate-scheduled-actions/
├── AGENTS.md                                  # always-on framing
├── src/
│   ├── agents/flue-ideation.ts                # pure wiring: model + sandbox + tools
│   └── tools/github/{github.ts,helpers.ts}    # list/open idea Discussions (GraphQL)
├── .agents/skills/flue-ideation/
│   ├── SKILL.md                               # the procedure + charter
│   └── references/idea-template.md            # the idea discussion body shape
├── .github/workflows/ideate.yml               # hourly cron → clone Flue → flue run
└── context/flue/                              # Flue cloned at runtime (gitignored)
```
