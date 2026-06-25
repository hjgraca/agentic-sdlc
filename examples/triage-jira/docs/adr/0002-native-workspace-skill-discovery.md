# Skills use Flue's native workspace discovery, not a custom source

## Status

accepted — supersedes ADR-0001

## Context

ADR-0001 set out to build a pluggable `SkillSource` so skills could be detached
from agent code and resolved at runtime. On inspecting the installed runtime, it
turned out Flue already does exactly this: at `init()` it scans
`<cwd>/.agents/skills/<name>/SKILL.md` from the session's sandbox
(`discoverLocalSkills`), merges discovered skills with any imported ones, skips
malformed `SKILL.md` with a warning, and **rereads `SKILL.md` on activation** so
edits land without re-initialising. The custom abstraction was reinventing a
native capability.

## Decision

Drop the custom `SkillSource` (`src/skill-source/`) and the bundled
`with { type: 'skill' }` imports. Skills live in `.agents/skills/<name>/` and are
discovered natively. The agent is given a `local({ cwd })` sandbox so discovery
has a filesystem to read; `cwd` is `process.env.SKILLS_DIR ?? process.cwd()`, so
production mounts the Skills Project and points `SKILLS_DIR` at it.

Likewise, the agent's framing lives in `AGENTS.md` (also discovered from the
sandbox cwd), not a `src/instructions/` folder or an `instructions` field — so
there is no instruction prose in `src/` to trace through import wiring.

## Consequences

- Far less code: no interface, no `defineSkill` plumbing, no `loadSkills`. The
  agent file is wiring + a sandbox line.
- Still satisfies the original goals: skills are detached (a directory, not
  imports), resolved at runtime (the env-driven `cwd`), and on a separate release
  cycle (mount/replace the directory, no rebuild). More dynamic than ADR-0001's
  design, since bodies are reread per activation, not frozen at init.
- skills.sh stays the delivery mechanism: `skills add <owner/repo>` installs into
  the directory `SKILLS_DIR` points at.
- Trade-off vs ADR-0001: no `gitRepo()`/`registry()` abstraction seam. If a
  non-filesystem source is ever required, revisit — but a mounted directory
  (incl. an init-container `skills add`) covers the known targets.
- Note on fail-fast (ADR-0001): native discovery does **not** fail on an empty
  `.agents/skills/`; it just discovers nothing. If a hard "no skills = don't
  boot" guarantee is needed, add an explicit startup check.
