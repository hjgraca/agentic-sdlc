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

## Principles

### Inbound is a channel, outbound is a tool
The single rule that decides where an integration goes:

- A provider you **receive events from** (a webhook) → a **channel**. It verifies
  the request and dispatches to the agent. It never calls back out.
- A provider you only **call** → a set of **tools**. The agent invokes them; they
  never receive anything.

A provider can be both. In `triage-jira`, Jira is a *channel* (the webhook in)
and a *tool* (read issue / post comment out); GitLab and Confluence are
tools-only because the agent only calls them.

### The agent file is wiring; prose lives outside it
`src/agents/<name>.ts` declares the model, sandbox, and tool set — nothing else.
The agent's role is in `AGENTS.md`; its procedure is in a skill. This keeps the
behavior editable by non-developers and on a separate release cycle from code.
See [adding-skills.md](adding-skills.md).

### Skills are discovered, not bundled
Flue reads `AGENTS.md` and `.agents/skills/` from the sandbox cwd at `init()`,
and rereads a skill on each activation. The agent points its sandbox at
`process.env.SKILLS_DIR ?? process.cwd()`, so production can mount a different
skill set without rebuilding. (See `examples/triage-jira/docs/adr/0002-*`.)

### Secrets come from the environment, never code
Credentials are read from `process.env` at call time and supplied per
environment (local `.env`, Kubernetes Secret, CI masked variable, cloud IAM).
No keys in code or committed config. Each example ships a `.env.example` and,
where relevant, a `secret.example.yaml` with placeholders only.

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
