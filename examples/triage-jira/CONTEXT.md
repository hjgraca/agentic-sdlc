# Context — Jira Triage Agent

Glossary of the domain language for this project. Implementation details live in
code and ADRs, not here.

## Terms

### Agent Project
The developer-owned codebase (this repo): the Flue agents, tools, runtime
configuration, and deploy artifacts. Changes on a developer release cycle.

### Skills Project
The separately-released, non-developer-owned set of skills (`SKILL.md` files and
their `references/`). Authored by domain experts (e.g. the roles a ticket should
be reviewed against). Changes on its own, more frequent release cycle than the
Agent Project.

### Workspace skill discovery
Flue's native mechanism: at `init()` it scans
`<cwd>/.agents/skills/<name>/SKILL.md` from the agent's sandbox, merges what it
finds with any imported skills, and rereads each `SKILL.md` on activation. This
is *how* the Skills Project is detached from agent code — skills are a directory,
not imports. The agent points its sandbox `cwd` at `SKILLS_DIR` (env) so the
discovery directory is environment-controlled at runtime. See ADR-0002.

### Skills registry (skills.sh)
The distribution channel for the Skills Project. The Skills Project is a git
repo published to skills.sh; the `skills` CLI (`skills add <owner/repo>`)
installs its skills into the `.agents/skills/` directory the agent's sandbox cwd
points at, at **deploy time**. Chosen over the skills.sh runtime API so there is
no network call, token, or new failure mode on the per-ticket hot path.

### Skill Resolver (deferred)
A per-request resolver that picks which skills apply to a given ticket (modeled
on eve's `defineDynamic`). Considered, then deferred: deploy-time install fixes
the skill set per deployment, which already satisfies the independent
release-cycle requirement. Per-ticket role selection, if needed later, can be
done at the prompt level over the installed skills — no new Flue API required.
