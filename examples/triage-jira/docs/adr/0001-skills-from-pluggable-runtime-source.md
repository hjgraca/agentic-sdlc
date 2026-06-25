# Skills come from a pluggable, runtime-resolved Skill Source

## Status

superseded by ADR-0002 — the custom `SkillSource` was unnecessary; Flue
discovers skills from `.agents/skills/` natively at runtime. The reasoning below
(detached skills, runtime resolution, fail-fast intent) still informs ADR-0002.

## Context

The skills the agent runs (the "what would each review role consider" knowledge)
change on a faster, separate release cycle than the agent code, and are
authored by non-developers. We want them detached from the Agent Project and
delivered from a pluggable source — a filesystem directory now, a git repo or a
self-hosted registry later — the same way Flue makes sandboxes and channels
pluggable. Distribution is via skills.sh (`skills add <owner/repo>`) at deploy
time as the first concrete pipe.

## Decision

Skills are loaded through a **`SkillSource`** abstraction modeled on **eve's
two-layer extensibility pattern** (its `ProjectSource` backing-store interface +
`define*` definition modules), which also lines up with Flue's own
`SandboxFactory` precedent. The source is resolved at **runtime** (process boot
/ session), not baked in at build time. flue PR #73's `skillsPath: string` is
adopted as the first implementation (the `disk` store with a configurable path),
not the public surface.

Two layers:

1. **Backing store** — a small injected interface (read listing / read file /
   stat), like eve's `ProjectSource`. `disk` first; `gitRepo`/`registry` later.
2. **Configuration** — the source is chosen in **agent code** (`skillSource:
   directory(...)`), and runtime values (path, URL, token) are read from
   `process.env` **inside the source's own functions**, per-use — eve's
   `getToken: () => process.env.X` pattern. **Not** in `flue.config.ts`; a
   build-time config file can't carry runtime resolution and is the wrong layer
   for choosing an implementation.

Dev and prod use the **same mechanism**: skills are installed into a directory
(`skills add ... --dir ./.skills` locally, a mount in prod) and discovered from
there. No `with { type: 'skill' }` bundled imports — those created a second
loading path and dev/prod drift.

## Considered Options

- **`skillsPath: string` as-is (PR #73)** — too narrow; hardcodes "directory"
  as the only source and forecloses git/registry sources.
- **Build-time source (parity with `db.ts`)** — freezes skills into the
  artifact; "update skills" would always mean "rebuild the agent", killing the
  independent release cycle and the future swap-without-rebuild story.
- **Per-request dynamic resolver (eve `defineDynamic`)** — deferred; deploy-time
  install already fixes the skill set per deployment, and per-ticket role
  selection can be done at the prompt level over installed skills.

## Consequences

- We are contributing/forking a new capability into Flue (a `SkillSource`
  interface), not just consuming one — larger than porting PR #73, but
  generalizes it.
- A runtime source may read env/network at boot, so failure modes (missing
  mount, unreachable registry) move to startup; the `directory()` impl keeps the
  hot path filesystem-only.
- The in-repo `src/skills/` is really Skills-Project content living here
  temporarily; the clean end-state moves it to its own repo published to
  skills.sh.
- **Fail-fast on an empty source.** A configured source that resolves to zero
  skills (missing mount, unreachable registry, broken `skills add`) is a startup
  error, not a degraded boot. For a webhook agent whose job is the triage skill,
  a degraded boot means every ticket gets a broken triage silently; a crash-loop
  is the louder, safer signal.
