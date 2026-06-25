# Shared architecture

Every example in this repository is the same handful of pieces in the same
arrangement. Once you understand it, each example is a small variation: a
different trigger, a different deploy target, a different skill.

## The pieces

```
AGENTS.md                         # the agent's always-on framing (discovered from cwd)
.agents/skills/<name>/SKILL.md     # the procedure the agent follows (discovered at runtime)
src/
├── agents/<name>.ts               # pure wiring: model + sandbox + tools. No prose.
├── channels/<provider>.ts         # inbound: verify trigger → dispatch to agent
└── tools/<provider>/              # outbound: the API calls the agent makes
```

## The one rule to internalize: inbound is a channel, outbound is a tool

- A provider you **receive events from** (a webhook) → a **channel**. It verifies
  the request and dispatches to the agent. It never calls back out.
- A provider you only **call** → a set of **tools**. The agent invokes them; they
  never receive anything.

A provider can be both. In `triage-jira`, Jira is a *channel* (the webhook in)
and a *tool* (read issue / post comment out); GitLab and Confluence are
tools-only because the agent only calls them.

The remaining conventions — agent files are pure wiring, skills are discovered
not bundled, secrets come from the environment, model is a configurable
specifier — are written up in the repo-root [AGENTS.md](../AGENTS.md). Adding or
changing skills: [adding-skills.md](adding-skills.md).

## What varies between examples

| Dimension | triage-jira | build-gitlab | review-github |
|---|---|---|---|
| Trigger | Jira webhook (channel) | GitLab CI pipeline (`flue run`) | GitHub Actions (`flue run`) |
| Runs on | Kubernetes (long-running) | GitLab runner (one-shot) | Actions runner (one-shot) |
| Outbound tools | Jira, GitLab, Confluence | GitLab | GitHub |
| Output | Jira comment | merge request | PR review comments |

Long-running (webhook) examples use a **channel**; CI-driven examples are
**one-shot** — the pipeline runs `flue run <agent>` and exits, so they need no
channel or load balancer, just the runner's checkout and env.
