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

```mermaid
flowchart LR
    Jira["Jira<br/>(new/updated ticket)"]
    Trigger["GitLab pipeline<br/>trigger API"]
    Queue["GitLab<br/>queues pipeline"]
    SkillsRepo["Skills repo<br/>(skills.sh, own release cycle)"]

    subgraph runner["GitLab runner (one-shot job)"]
        Before["before_script<br/>npm ci · skills add -a universal<br/>(if SKILLS_REPO) → SKILLS_DIR"]
        Run["flue run jira-triage<br/>--input ISSUE_KEY"]
        Agent["jira-triage agent<br/>(model + sandbox + tools)"]
        CWD[("cwd / SKILLS_DIR<br/>AGENTS.md + .agents/skills/")]
        Before -->|writes| CWD
        CWD -.->|"framing + procedure<br/>discovered at init()"| Agent
        Before --> Run --> Agent
    end

    Bedrock["AWS Bedrock<br/>claude-sonnet-4-6"]
    GitLab["GitLab<br/>(commits / MRs / files)"]
    Confluence["Confluence<br/>(standards)"]

    Jira -->|"POST .../trigger/pipeline<br/>variables[ISSUE_KEY]"| Trigger
    Trigger --> Queue --> Before
    SkillsRepo -.->|"git clone (GITLAB_TOKEN)"| Before
    Agent <-->|"InvokeModel<br/>(AWS_BEARER_TOKEN_BEDROCK)"| Bedrock
    Agent -->|read issue| Jira
    Agent -->|search| GitLab
    Agent -->|read pages| Confluence
    Agent -->|post triage comment| Jira
    Agent -.->|exit| runner
```

```yaml
# .gitlab-ci.yml (ships in this folder) — the job that runs `flue run`
triage:
  image: node:22
  timeout: 30 minutes
  rules:
    - if: '$CI_PIPELINE_SOURCE == "trigger" && $ISSUE_KEY'
  before_script:
    - npm ci
    # Optional: fetch the Skills Project from its own repo (separate release
    # cycle) via skills.sh. Set SKILLS_REPO=org/path as a CI/CD var; omit to use
    # the skills committed in this repo.
    - |
      if [ -n "$SKILLS_REPO" ]; then
        git config --global url."https://oauth2:${GITLAB_TOKEN}@gitlab.com/".insteadOf "https://gitlab.com/"
        mkdir -p ./skills && (cd ./skills && npx -y skills add "https://gitlab.com/${SKILLS_REPO}" -a universal -y)
        export SKILLS_DIR="$CI_PROJECT_DIR/skills"
      fi
  script:
    - ./node_modules/.bin/flue run jira-triage --input "{\"message\":\"Triage Jira issue $ISSUE_KEY.\"}"
  # CI/CD variables (Settings → CI/CD → Variables): JIRA_BASE_URL, JIRA_EMAIL,
  # JIRA_API_TOKEN, GITLAB_TOKEN, AWS_BEARER_TOKEN_BEDROCK, AWS_REGION; optional
  # SKILLS_REPO. See the committed .gitlab-ci.yml for the git clone alternative.
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

## Deploy

1. Set the masked CI/CD variables in GitLab (Settings → CI/CD → Variables):
   `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `GITLAB_TOKEN`,
   `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`. `GITLAB_TOKEN` must be a
   group-scoped token (read_api + read_repository) so the agent can read every
   project the skill lists — cross-project access depends on the token, not on
   the runner.
   - On a **shared runner** there is no IAM role, so Bedrock auth comes from
     `AWS_BEARER_TOKEN_BEDROCK` (a Bedrock-scoped, short-lived token — prefer
     this over admin AWS keys). ⚠️ It expires: refresh it before each run, or use
     a self-managed runner with a Bedrock-only IAM role.
2. Create a pipeline trigger token (Settings → CI/CD → Pipeline trigger tokens).
3. Point the Jira automation's "Send web request" at the trigger API URL above,
   passing `variables[ISSUE_KEY]={{issue.key}}`.

### Skills in production

The skill committed in this repo's `.agents/skills/` is the default. To run the
skills from their own repo on a **separate release cycle** (without changing this
agent), set the optional CI/CD variable `SKILLS_REPO` (the repo path, `org/path`).
The `before_script` installs it with `skills add -a universal` — which lands
straight in `.agents/skills/` — and exports `SKILLS_DIR`; Flue discovers
`$SKILLS_DIR/.agents/skills/` at init. No rebuild — the next pipeline picks it
up. The repo is private, so the token reaches git via a one-line
`git config … insteadOf` (skills.sh strips credentials from the URL). A plain
`git clone` alternative is in the committed `.gitlab-ci.yml` and
[docs/adding-skills.md](../../docs/adding-skills.md).

This is the runner counterpart to `triage-jira-k8s`'s init-container fetch — same
`SKILLS_DIR` contract, same skills.sh delivery, just a one-shot job instead of a
long-running pod.

## Trigger drives deploy

This pairing — Jira automation → GitLab pipeline trigger → one-shot runner — is
the CI-driven counterpart to `triage-jira-k8s`'s webhook → long-running server.
Same agent, different ingress. See [AGENTS.md](../../AGENTS.md).
