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

### 2. Fetch at runtime with skills.sh (production, no rebuild)
The agent's sandbox cwd is `process.env.SKILLS_DIR ?? process.cwd()`, and Flue
discovers skills from `<cwd>/.agents/skills/`. Materialize your skills directory
somewhere at boot and point `SKILLS_DIR` at it; your skills override what ships
in the image. The examples do this with [skills.sh](https://skills.sh), whose
`add` command accepts a GitHub `owner/repo` shorthand **or any git URL —
including a private GitLab repo** — so the same Skills Project repo is the source
everywhere:

```bash
npx skills add https://gitlab.com/<org>/<repo> -a universal -y
export SKILLS_DIR="$PWD"   # Flue discovers $PWD/.agents/skills/
```

**Use `-a universal`.** `SKILLS_DIR` is a *base path* — Flue always appends the
literal `.agents/skills` to it (not configurable). skills.sh installs to a folder
named for the `-a` agent: `universal` (and `promptscript`) write to
`.agents/skills/`, but `pi` → `.pi/skills/`, `claude-code` → `.claude/skills/`,
`eve` → `agent/skills/`. Only `universal` lines up with Flue out of the box;
there is no `--dir` flag to override it. (No `--copy` needed — when no agent is
auto-detected, skills.sh writes real files, not symlinks.)

**Private-repo auth.** skills.sh shells out to `git clone` but **strips any
`oauth2:token@` from the URL** before cloning, so a credentialed URL does not
work. Instead give git the credential *below* the CLI with an `insteadOf`
rewrite, using a token already in the environment:

```bash
git config --global url."https://oauth2:${GITLAB_TOKEN}@gitlab.com/".insteadOf "https://gitlab.com/"
npx skills add "https://gitlab.com/<org>/<repo>" -a universal -y
```

How each deploy target wires this (run at boot, so a restart/next pipeline picks
up new skills with no rebuild):

- **Kubernetes** — a `node:22` init container runs the two lines above into a
  shared `emptyDir`; the app container sets `SKILLS_DIR=/skills`. The token comes
  from the Secret. See [`triage-jira-k8s/k8s/base/deployment.yaml`](../examples/triage-jira-k8s/k8s/base/deployment.yaml).
- **CI runner** — a `before_script` step runs them in the workspace and exports
  `SKILLS_DIR` before `flue run`; the token is a CI/CD variable. See
  [`triage-jira-gitlab-runner/.gitlab-ci.yml`](../examples/triage-jira-gitlab-runner/.gitlab-ci.yml).

> **On Kubernetes, not a ConfigMap.** A ConfigMap caps at ~1 MB and flattens
> directory structure, so it can't carry a skill's `references/` subtree. The
> `emptyDir` populated by the init container has neither limit.

### 3. Plain `git clone` (no skills.sh)
If you'd rather not depend on skills.sh, clone a repo whose **root holds
`.agents/skills/`** directly and point `SKILLS_DIR` at the checkout. This takes a
credentialed URL straight (nothing strips it) and lets you pin a tag/sha:

```bash
git clone --depth 1 --branch <tag> "https://oauth2:${GITLAB_TOKEN}@gitlab.com/<org>/<repo>" ./skills
export SKILLS_DIR="$PWD/skills"
```

Both example deploy targets ship this as a commented alternative next to the
skills.sh path. The trade-off: `git clone` pins a ref and needs no extra tool,
but the repo layout must already match `.agents/skills/`; skills.sh discovers
skills wherever they live in the source repo and normalizes them into
`.agents/skills/`.

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
end-to-end against the live triage agent. The test: a separate private GitLab
skills repo whose `SKILL.md` prepends a unique marker to the posted Jira comment,
so the comment itself proves which skill ran. In every case the **agent build
was unchanged** — only the injected skills differed.

| Path | How skills are delivered (skills.sh, `-a universal`) | Proof |
|---|---|---|
| **Local** | `skills add` into a dir; `SKILLS_DIR=<dir> flue run` | default run had no marker; override run did |
| **GitLab runner** | `before_script` runs `skills add`, exports `SKILLS_DIR` | job log shows clone + `Installing all 1 skills` → `Done!`; comment carried the marker |
| **Kubernetes** | `node:22` init container runs `skills add` into an `emptyDir`; app sets `SKILLS_DIR=/skills` | init container exits 0, `/skills/.agents/skills/` mounted; webhook triage carried the marker |

Key facts each path confirmed:

- **A private GitLab repo works as the skills source** in all paths, authenticated
  by a one-line `git config … insteadOf` using `GITLAB_TOKEN` (skills.sh strips a
  token from the URL, so it must be given to git below the CLI).
- **`-a universal` installs straight to `.agents/skills/`** — Flue's discovery
  path — with the `references/` subtree intact; no symlink, no `--dir` flag.
- **A rolling restart (k8s) / next pipeline (runner) re-runs the fetch**, so new
  skills land with no app rebuild — the separate-release-cycle goal.
- **On Kubernetes, `emptyDir` + init container, never a ConfigMap** — the ~1 MB
  cap and flattened layout can't carry a skill's `references/` subtree.
- A plain **`git clone`** is the documented alternative when you'd rather pin a
  tag/sha or avoid the skills.sh dependency.
