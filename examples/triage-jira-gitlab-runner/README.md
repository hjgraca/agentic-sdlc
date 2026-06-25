# triage-jira-gitlab-runner — Jira triage, one-shot on a GitLab runner

> One of the [Flue Agent Reference Architectures](../../README.md). See
> [AGENTS.md](../../AGENTS.md) for the shared patterns and
> [docs/adding-skills.md](../../docs/adding-skills.md) for adding your own skills.

> 📝 **Skeleton.** Documents the shape and ships the CI wiring + starter skill.
> The agent/tools are the same as [`../triage-jira-k8s/`](../triage-jira-k8s/) —
> copy them in (see TODO).

The **same triage agent** as `triage-jira-k8s` (reads the ticket, enriches with
GitLab + Confluence, posts a comment back), but deployed **one-shot on a GitLab
runner** instead of a long-running Kubernetes server. The agent, tools, and skill
are identical — only the **trigger and deploy** differ.

## Why no channel — and how Jira reaches a runner

A GitLab runner is a one-shot CI executor; it has **no always-on listener** for
Jira to POST a webhook to. So there is no Flue channel here. Instead, the Jira
automation calls **GitLab's pipeline trigger API**, which queues a pipeline that
a runner picks up:

```
Jira automation "Send web request"
  → POST https://gitlab.com/api/v4/projects/<PROJECT_ID>/trigger/pipeline
         ?token=<TRIGGER_TOKEN>&ref=main
         &variables[ISSUE_KEY]={{issue.key}}
  → GitLab queues a pipeline → a runner runs the job below → exits
```

The issue key arrives as a CI variable (`$ISSUE_KEY`); `flue run` is the entry
point. No webhook server, no load balancer, no Kubernetes.

```yaml
# .gitlab-ci.yml (ships in this folder)
triage:
  image: node:22
  rules:
    - if: '$ISSUE_KEY'          # only run when triggered with an issue key
  script:
    - npm ci
    - npx flue run jira-triage --input "{\"issueKey\":\"$ISSUE_KEY\"}"
  variables:
    # masked CI/CD variables (Settings → CI/CD → Variables):
    #   JIRA_API_TOKEN, GITLAB_TOKEN, JIRA_BASE_URL, JIRA_EMAIL
    GIT_DEPTH: "1"
```

## Shape

```
AGENTS.md                              # agent framing (same as triage-jira-k8s)
.agents/skills/jira-triage/SKILL.md     # the triage procedure (same skill)
.gitlab-ci.yml                          # the pipeline job that runs `flue run`
src/
├── agents/jira-triage.ts              # model + local() sandbox + tools — NO channel
└── tools/{atlassian,gitlab}/           # same outbound tools as triage-jira-k8s
```

The only code difference from `triage-jira-k8s`: **no `src/channels/`** (the
pipeline is the trigger) and no `k8s/` (the runner is the deploy).

## TODO to complete this example

- [ ] Copy `src/agents/jira-triage.ts`, `src/tools/`, `AGENTS.md`,
      `.agents/skills/`, `package.json`, `flue.config.ts`, `tsconfig.json` from
      [`../triage-jira-k8s/`](../triage-jira-k8s/).
- [ ] Delete `src/channels/` — ingress is the pipeline trigger, not a webhook.
- [ ] Confirm the agent reads `issueKey` from the run input (it already accepts a
      `message`; the skill takes `issueKey`).
- [ ] Set the masked CI/CD variables in GitLab; create a pipeline trigger token.
- [ ] Point the Jira automation web request at the trigger API URL above.

## Trigger drives deploy

This pairing — Jira automation → GitLab pipeline trigger → one-shot runner — is
the CI-driven counterpart to `triage-jira-k8s`'s webhook → long-running server.
Same agent, different ingress. See [AGENTS.md](../../AGENTS.md).
