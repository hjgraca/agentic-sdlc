# build-gitlab — implement an issue, open a merge request

> 📝 **Skeleton.** This example documents the intended shape and ships a starter
> skill. The tools and CI wiring are stubs to be fleshed out — see "TODO" below.

A Flue agent that takes a GitLab issue describing a change, implements it in a
sandbox, and opens a merge request. Unlike `triage-jira-k8s`, there is **no
channel** — it runs **one-shot inside a GitLab CI pipeline** and exits.

## Why no channel

`triage-jira-k8s` is a long-running server because a webhook can arrive any time.
This example is triggered by a GitLab CI pipeline (e.g. on an issue label or a
manual job), so the natural shape is:

```yaml
# .gitlab-ci.yml (sketch)
build-from-issue:
  image: node:22
  rules:
    - if: '$CI_PIPELINE_SOURCE == "web"'   # or trigger / schedule
  script:
    - npm ci
    - npx flue run code-builder --input "{\"issueId\":\"$ISSUE_ID\"}"
  variables:
    GITLAB_TOKEN: $GITLAB_TOKEN            # masked CI variable
```

The pipeline *is* the trigger; `flue run` is the entry point. No webhook, no load
balancer, no Kubernetes — the runner's checkout and masked CI variables are the
whole environment.

## Shape

```
AGENTS.md                              # agent framing
.agents/skills/build-from-issue/SKILL.md   # the procedure (ships below)
src/
├── agents/code-builder.ts             # model + local() sandbox + GitLab tools
└── tools/gitlab/                       # read issue, create branch, commit, open MR
```

The agent uses a writable `local()` sandbox so it can actually edit files and run
the project's build/tests before opening the MR.

## TODO to complete this example

- [ ] `src/tools/gitlab/gitlab.ts` — get issue, create branch, push commits, open MR
      (write operations, unlike triage-jira-k8s's read-only GitLab tools).
- [ ] `src/agents/code-builder.ts` — wire model + `local()` sandbox + tools.
- [ ] `AGENTS.md` + the build-from-issue skill (starter included).
- [ ] `.gitlab-ci.yml` — the pipeline job that runs `flue run`.
- [ ] `package.json`, `flue.config.ts`, `tsconfig.json` (copy from `triage-jira-k8s`).

## Pattern reference

See [`../../AGENTS.md`](../../AGENTS.md) for the conventions and the complete
[`../triage-jira-k8s/`](../triage-jira-k8s/) example.
