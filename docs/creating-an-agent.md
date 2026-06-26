# Creating an agent from scratch

> 🤖 **Coding agents:** there is an agent-facing checklist version of this with
> the gotchas inline — the `create-agent` skill (`.claude/skills/create-agent/`),
> which auto-loads when someone asks to "create an agent / bot". This doc is the
> human walkthrough.

This guide builds a new agent the way the examples in this repo are built. It's
**Flue-first** — the examples use [Flue](https://flueframework.com) — but the
*shape* (an agent = framing + a skill + per-provider tools + a trigger) is
framework-agnostic; see [Other frameworks](#other-frameworks) at the end.

We'll recreate `triage-jira-gitlab-runner` (a one-shot, CI-triggered triage
agent) so you can follow along against a real example.

## Prerequisites

- Node.js `>= 22.19.0`
- An LLM model specifier + its credential (this repo uses
  `amazon-bedrock/us.anthropic.claude-sonnet-4-6`; see
  [AGENTS.md → Model & provider](../AGENTS.md) to pick another).

## 1. Scaffold a Flue project

```bash
mkdir my-agent && cd my-agent
npm install @flue/runtime
npm install --save-dev @flue/cli
npx flue init --target node        # creates flue.config.ts
printf 'node_modules\ndist\n.env\n.flue\n' > .gitignore
```

> Run the CLI as `./node_modules/.bin/flue` — `npx flue` resolves to an
> unrelated public package named `flue`.

## 2. Decide the trigger first — it determines everything else

The trigger model is the primary choice (see
[AGENTS.md → Trigger drives deploy](../AGENTS.md)):

- **Webhook** → a long-running server with a Flue **channel**
  (`src/channels/<provider>.ts`) that verifies the request and dispatches to the
  agent. Deploy: k8s / a VM. (This is `triage-jira-k8s`.)
- **CI event** → **one-shot** `flue run`, no channel. The pipeline is the
  trigger; the input arrives as a CI variable. Deploy: a runner. (This is
  `triage-jira-gitlab-runner` — what we build here.)

## 3. Write the agent (pure wiring, no prose)

`src/agents/jira-triage.ts` — model + sandbox + tools only. The agent's *role*
goes in `AGENTS.md`; its *procedure* goes in a skill (next steps).

```ts
import { defineAgent } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as jiraTools from '../tools/atlassian/jira.ts';
import * as confluenceTools from '../tools/atlassian/confluence.ts';
import * as gitlabTools from '../tools/gitlab/gitlab.ts';

// Flue discovers AGENTS.md and .agents/skills/ from the sandbox cwd at init().
const cwd = process.env.SKILLS_DIR ?? process.cwd();

export default defineAgent(() => ({
  model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
  sandbox: local({ cwd }),
  tools: [
    ...Object.values(jiraTools),
    ...Object.values(confluenceTools),
    ...Object.values(gitlabTools),
  ],
}));
```

## 4. Add tools (outbound API calls), grouped per provider

A **tool** is something the agent *calls*. Group them under
`src/tools/<provider>/` and define each with `defineTool` (see
`triage-jira-k8s/src/tools/` for full examples — read issue, add comment, search
commits, read a Confluence page). Credentials are read from `process.env` at
call time — never hardcoded.

> **Inbound is a channel, outbound is a tool.** A provider you *receive* webhooks
> from is a channel; one you only *call* is a set of tools. Jira is both here
> (channel in the k8s variant, tools either way); GitLab and Confluence are
> tools-only.

## 5. Write the skill (the procedure) and AGENTS.md (the framing)

`AGENTS.md` — one or two lines of always-on framing:

```
You triage Jira bug tickets and enrich them with GitLab source-control context
and the team's Confluence documentation standards. Use the jira-triage skill to
do this work.
```

`.agents/skills/jira-triage/SKILL.md` — the step-by-step procedure, with
frontmatter `name` + `description`. See
[docs/adding-skills.md](adding-skills.md) for the full skill format. Skills are
discovered at runtime — no imports, editable without a rebuild.

## 6. Run it locally

```bash
printf 'AWS_PROFILE=your-profile\nAWS_REGION=us-west-2\nJIRA_BASE_URL=...\n' > .env
./node_modules/.bin/flue run jira-triage \
  --input '{"message":"Triage Jira issue KAN-15."}'
```

`flue run` input must be an object with a string `message`. The skill picks the
issue key out of it.

## 7. Wire the trigger + deploy

For the CI/one-shot path, add a `.gitlab-ci.yml` that runs `flue run` when the
pipeline is triggered with the issue key as a variable, and point a Jira
automation at GitLab's pipeline trigger API. The complete wiring is in
[`../examples/triage-jira-gitlab-runner/`](../examples/triage-jira-gitlab-runner/).

For the webhook path instead, add `src/channels/<provider>.ts` and deploy the
server — see [`../examples/triage-jira-k8s/`](../examples/triage-jira-k8s/).

## Other frameworks

This repo is Flue-first, but the architecture is portable. The same agent is, in
any framework: **framing** (system prompt) + **a procedure** (skill / prompt
template) + **outbound tools** (typed function calls) + **a trigger** (webhook
listener or CI one-shot). Building it directly on **[Pi](https://pi.dev)** (the
provider layer Flue itself uses) or another agent framework means re-expressing
those same four pieces with that framework's primitives.

> 📝 A Pi-based variant is not yet implemented. If added, it would live as its
> own example (e.g. `triage-jira-pi-…`) following the same naming and the same
> four-piece shape.
