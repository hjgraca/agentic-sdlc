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
Skills are distributable as git repos via [skills.sh](https://skills.sh):

```bash
skills add <owner>/<repo> --dir "$SKILLS_DIR/.agents/skills"
```

Run this at deploy time (CI step or init container) so the agent discovers them
at boot. No code change, separate release cycle from the agent.

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
