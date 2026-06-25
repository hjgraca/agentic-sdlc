# Flue Agent Reference Architectures

Production-shaped examples of autonomous agents built on
[Flue](https://flueframework.com). Each example under `examples/` is a complete,
independently-clonable Flue app — copy one folder, set its secrets, deploy.

They share a common architecture (below); they differ in the *channel* that
triggers them and the *deploy target* they run on.

## Examples

Examples are named `<function>-<primary-stack>`. The folder name is just a
unique handle — **find your fit by the columns below**, not the name. A customer
filters by what they have: work source, code host, trigger, and where it runs.

| Example | Function | Work source | Code host | Extras | Trigger | Deploy | Status |
|---|---|---|---|---|---|---|---|
| [`triage-jira`](examples/triage-jira/) | triage a ticket, post enriched analysis back | Jira | GitLab | Confluence | webhook | Kubernetes (EKS) | ✅ complete |
| [`build-gitlab`](examples/build-gitlab/) | implement an issue, open a merge request | GitLab issue | GitLab | — | CI pipeline | GitLab runners | 📝 skeleton |
| [`review-github`](examples/review-github/) | review a PR for security issues | GitHub PR | GitHub | — | Actions event | GitHub Actions | 📝 skeleton |

Want triage on a different stack (e.g. Linear + GitLab + GitLab runners)? That's
a new row/folder, not a config switch — each example is pinned to one trigger and
one deploy, because the trigger model (webhook vs CI one-shot) determines the
deploy.

## The shared architecture

Every example follows the same shape. Learn it once; each example is a variation.

- **Agent** (`src/agents/<name>.ts`) — pure wiring: model, sandbox, tools. No
  prose. The agent's framing lives in `AGENTS.md`, its procedure in a skill.
- **Skills** (`.agents/skills/<name>/SKILL.md`) — the procedure, discovered
  natively by Flue at runtime from the sandbox cwd. Detached from code, on their
  own release cycle. See [docs/adding-skills.md](docs/adding-skills.md).
- **Channel** (`src/channels/<provider>.ts`) — inbound only: verifies the
  trigger and dispatches to the agent. (CI-driven examples use a one-shot
  `flue run` instead of a long-running channel.)
- **Tools** (`src/tools/<provider>/`) — outbound only: the API calls the agent
  makes, grouped by provider.
- **Inbound = channel, outbound = tools.** A provider you *receive* from is a
  channel; one you only *call* is a set of tools.

See [AGENTS.md](AGENTS.md) for the full conventions.

## Adding your own skills

You do not modify agent code to change what an agent does — you edit or add a
skill. Full guide: [docs/adding-skills.md](docs/adding-skills.md).

## Getting started

Pick an example and follow its README:

```bash
cd examples/triage-jira
cat README.md
```
