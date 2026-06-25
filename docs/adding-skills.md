# Adding your own skills

A skill is the *procedure* an agent follows — what to do, which tools to call,
what to produce. Skills are plain markdown, discovered by Flue at runtime. **You
never edit agent code to change what an agent does; you add or edit a skill.**

## What a skill looks like

A skill is a folder with a `SKILL.md` (and optional `references/`):

```
.agents/skills/
└── my-skill/
    ├── SKILL.md                 # required: frontmatter + the procedure
    └── references/              # optional: supporting docs the skill tells the agent to read
        └── checklist.md
```

`SKILL.md` has YAML frontmatter and a markdown body:

```markdown
---
name: my-skill
description: One line — what it does and when to use it. The agent reads this to decide whether to activate the skill.
---

The body is the procedure. Write it as instructions to the agent:

1. Read the input...
2. Use the `some_tool` tool to...
3. Produce...

Read `references/checklist.md` and make sure your output satisfies it.
```

- `name` must be lowercase-kebab and match the folder name.
- `description` is how the agent decides to use it — write it for the model.
- The body and `references/` are reread on each activation, so edits take effect
  on the **next run, with no rebuild**.

## Three ways to add a skill

### 1. Edit in place (development)
Drop a folder under the example's `.agents/skills/`. Flue discovers it on the
next run. This is how the examples ship their skills.

### 2. Fetch at runtime (production, no rebuild)
The agent's sandbox cwd is `process.env.SKILLS_DIR ?? process.cwd()`, and Flue
discovers skills from `<cwd>/.agents/skills/`. Materialize your skills directory
somewhere at boot and point `SKILLS_DIR` at it; your skills override what ships
in the image. How each deploy target does it:

- **Kubernetes** — an init container `git clone`s (or `skills add`s) the Skills
  Project into a shared `emptyDir`, and the app container sets `SKILLS_DIR` to
  it. See [`triage-jira-k8s/k8s/base/deployment.yaml`](../examples/triage-jira-k8s/k8s/base/deployment.yaml).
- **CI runner** — a `before_script` step fetches the skills into the workspace
  and exports `SKILLS_DIR` before `flue run`. See
  [`triage-jira-gitlab-runner/.gitlab-ci.yml`](../examples/triage-jira-gitlab-runner/.gitlab-ci.yml).

> **Not a ConfigMap.** A ConfigMap caps at ~1 MB and flattens directory
> structure, so it can't carry a skill's `references/` subtree. Use an
> `emptyDir` populated by an init container instead.

### 3. Install from a registry (skills.sh)
[skills.sh](https://skills.sh) distributes skills as git repos. Its `add` command
accepts a GitHub `owner/repo` shorthand **or any git URL — including a GitLab
repo**, so the same Skills Project repo we use everywhere else is a valid source.

**Install with `-a universal`** — that target writes to exactly `.agents/skills/`,
which is the path Flue discovers, so no bridge is needed:

```bash
npx skills add https://gitlab.com/<org>/<repo> -a universal -s '*' --copy -y
export SKILLS_DIR="$PWD"   # Flue discovers $PWD/.agents/skills/
```

Use `--copy` so real files (not symlinks into a throwaway clone) land in the dir,
with the skill's `references/` subtree.

**Why the agent target matters.** `SKILLS_DIR` is a *base path* — Flue always
appends the literal `.agents/skills` to it (it is not configurable). skills.sh
installs to a folder named for the `-a` agent: `universal` (and `promptscript`)
use `.agents/skills/`, but `pi` → `.pi/skills/`, `claude-code` → `.claude/skills/`,
`eve` → `agent/skills/`. Only `universal` lines up with Flue out of the box; pick
any other and you'd have to symlink `.agents/skills` at its install dir. There is
no `--dir` flag to override the location. **Use `-a universal`.**

**Private repos rely on ambient git auth.** skills.sh shells out to `git clone`
with no token flag, so a private GitLab repo only works where git is already
authenticated (a credential helper, an `oauth2:$TOKEN@` remote, or an SSH key).
In CI/k8s, prefer the plain `git clone` paths in option 2 (they take
`GITLAB_TOKEN` explicitly); reserve skills.sh for local or public-registry use.

Run the install at deploy time (CI step or init container) so the agent discovers
the skills at boot. No code change, separate release cycle from the agent.

## Tools vs skills

A skill can only call tools the agent already has. If your new procedure needs a
capability the agent can't do yet (a new API call), add a **tool**
(`src/tools/<provider>/`) and register it on the agent — then write a skill that
uses it. Skills are *what to do*; tools are *what's possible*.

## Worked example

See [`examples/triage-jira-k8s/.agents/skills/jira-triage/`](../examples/triage-jira-k8s/.agents/skills/jira-triage/)
— a skill whose body lists the GitLab projects to search and references a
`triage-checklist.md`. A customer changes which projects are triaged, or what
the triage must contain, by editing that markdown — not the TypeScript.

## Verified in action

The override mechanism is one contract — *materialize `.agents/skills/`, point
`SKILLS_DIR` at its parent* — and every delivery path below was proven
end-to-end against the live triage agent. The test: a separate skills repo whose
`SKILL.md` prepends a unique marker to the posted Jira comment, so the comment
itself proves which skill ran. In all four, the **agent build was unchanged** —
only the injected skills differed.

| Path | How skills are delivered | Proof |
|---|---|---|
| **Local** | `SKILLS_DIR=/path/to/skills flue run` | default run had no marker; override run did |
| **GitLab runner** | `before_script` clones the skills repo, exports `SKILLS_DIR` | job log shows `Cloning into './skills'`; comment carried the marker |
| **Kubernetes** | `fetch-skills` init container clones into an `emptyDir`; app sets `SKILLS_DIR=/skills` | init container exits 0, `/skills/.agents/skills/` mounted; webhook triage carried the marker |
| **skills.sh** | `skills add <git-url> -a universal` (installs straight to `.agents/skills/`) | triage run via that dir carried the marker |

Key facts each path confirmed:

- **A private GitLab repo works as the skills source** in all paths; the clone
  just needs auth (explicit `GITLAB_TOKEN` in CI/k8s, ambient git for skills.sh).
- **`emptyDir` + init container, never a ConfigMap** — the ~1 MB cap and flattened
  layout can't carry a skill's `references/` subtree.
- **A rolling restart re-runs the init container**, so new skills land with no
  app rebuild — the separate-release-cycle goal.
- **skills.sh works with `-a universal`**, which installs straight to
  `.agents/skills/`; other agent targets (`pi`, `claude-code`, `eve`) use a
  different folder and would need a symlink, and there is no `--dir` flag.
