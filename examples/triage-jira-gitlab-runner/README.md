# triage-jira-gitlab-runner — Jira triage, one-shot on a GitLab runner

> One of the [Flue Agent Reference Architectures](../../README.md). See
> [AGENTS.md](../../AGENTS.md) for the shared patterns and
> [docs/adding-skills.md](../../docs/adding-skills.md) for adding your own skills.

The **same triage agent** as `triage-jira-k8s` (reads the ticket, enriches with
GitLab + Confluence, posts a comment back), but deployed **one-shot on a GitLab
runner** instead of a long-running Kubernetes server. The agent, tools, and skill
are identical — only the **trigger and deploy** differ: there is no
`src/channels/` (the pipeline is the trigger) and no `k8s/` (the runner is the
deploy).

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
    - ./node_modules/.bin/flue run jira-triage --input "{\"message\":\"Triage Jira issue $ISSUE_KEY.\"}"
  tags: [group-runner]      # target the group runner
  variables:
    # masked CI/CD variables set at GROUP level (Group → Settings → CI/CD):
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

## Run it locally (one-shot, exactly as CI does)

```bash
npm install
cp .env.example .env   # fill in real creds (Bedrock uses AWS_PROFILE — no key)
./node_modules/.bin/flue run jira-triage \
  --input '{"message":"Triage Jira issue KAN-15."}'
```

`flue run` input must be an object with a string `message`; the skill picks the
issue key out of it. The agent reads the ticket, searches the GitLab projects in
the skill, applies the Confluence standards, and posts a comment back.

## Deploy (group runner)

Variables and the runner live at the **group** level so every project in the
group shares them; the pipeline and its trigger token are necessarily
**project**-scoped (GitLab has no group-level pipeline).

1. **Group runner** — register/enable one under **Group → Build → Runners**. It
   executes jobs for every project in the group. (Tag it and set
   `tags: [group-runner]` in `.gitlab-ci.yml` to target it explicitly.)
2. **Group variables** — set the masked CI/CD variables under **Group →
   Settings → CI/CD → Variables**: `JIRA_BASE_URL`, `JIRA_EMAIL`,
   `JIRA_API_TOKEN`, `GITLAB_TOKEN`. Projects inherit them. Bedrock auth comes
   from the runner's IAM role / environment.
3. **Project pipeline + trigger token** — in the project that hosts this
   `.gitlab-ci.yml`, create a pipeline trigger token (**Project → Settings →
   CI/CD → Pipeline trigger tokens**).
4. **Jira automation** — point the "Send web request" at the project's trigger
   API URL, passing `variables[ISSUE_KEY]={{issue.key}}`.

## Trigger drives deploy

This pairing — Jira automation → GitLab pipeline trigger → one-shot runner — is
the CI-driven counterpart to `triage-jira-k8s`'s webhook → long-running server.
Same agent, different ingress. See [AGENTS.md](../../AGENTS.md).
