# triage-jira — Jira Triage Agent

> One of the [Flue Agent Reference Architectures](../../README.md). See
> [AGENTS.md](../../AGENTS.md) for the shared patterns and
> [docs/adding-skills.md](../../docs/adding-skills.md) for adding your own skills.

A [Flue](https://flueframework.com) project. A Jira webhook hits the Jira
channel, which dispatches to an agent that reads the ticket, searches the
relevant GitLab projects for related source-control activity, then posts an
enriched triage comment back to Jira.

## Structure

```
.agents/
└── skills/                  # skills, discovered natively by Flue at runtime
    └── jira-triage/
        ├── SKILL.md          # the triage procedure + the GitLab projects to search
        └── references/triage-checklist.md
AGENTS.md                    # the agent's always-on framing (discovered from cwd)
src/
├── agents/
│   └── jira-triage.ts        # the agent — pure wiring: model, sandbox, tools
├── channels/
│   └── jira.ts               # inbound webhook: verify secret → dispatch by issue key
└── tools/                   # outbound tools, organized by provider
    ├── atlassian/            # shared Atlassian Cloud auth + Jira + Confluence
    │   ├── auth.ts           # shared basic-auth header
    │   ├── jira.ts           # read issue / add comment
    │   └── confluence.ts     # read documentation pages
    └── gitlab/
        └── gitlab.ts         # search commits / MRs / read files
                              # (imported directly; no barrel index files)
k8s/
├── base/                     # generic, committed
│   ├── deployment.yaml       # Namespace + ServiceAccount + Deployment + NLB Service
│   ├── secret.example.yaml   # secret template (fill real values out-of-band)
│   └── kustomization.yaml
└── local/
    ├── kustomization.example.yaml  # overlay template (committed)
    └── kustomization.yaml          # your real account values (gitignored)
```

### Where the text lives

There is no instruction prose in `src/`. The agent file is pure wiring; all
text is discovered by Flue from the workspace at `init()`:

- **`AGENTS.md`** — the agent's always-on framing. Flue reads it from the
  sandbox cwd automatically; no import, no `instructions` field.
- **`.agents/skills/jira-triage/SKILL.md`** — the triage procedure *and* the
  GitLab projects to search (project names + ids are listed right in the skill).

### Skills are discovered natively, not bundled

Skills are **not** imported with `with { type: 'skill' }`. Flue discovers them at
`init()` from `<cwd>/.agents/skills/<name>/SKILL.md` inside the agent's sandbox,
and rereads `SKILL.md` on activation — so edits land without a rebuild. The
agent just needs a filesystem sandbox pointed at the right cwd:

```ts
const cwd = process.env.SKILLS_DIR ?? process.cwd();
const sandbox = local({ cwd });
```

- **Detached & separate release cycle.** Skills are a directory, not code. In
  production, fetch the Skills Project (e.g. an init container that `git clone`s
  it) and set `SKILLS_DIR` to point there — no rebuild. See
  [Skills in production](#skills-in-production) below.
- **Runtime-resolved.** `cwd` is read from `process.env` at boot, so the same
  build reads different skills per environment.
- **Dynamic.** Bodies are reread per activation, so a changed `SKILL.md` takes
  effect on the next ticket without re-initialising.

There is no workflow: this is a fire-and-forget job whose output is the Jira
comment the agent posts itself, so a bounded workflow with a structured return
value would be unused indirection. Add a workflow only if something downstream
needs to consume the triage *result* (e.g. a dashboard reading run history, or
a CI gate branching on the outcome).

## Flow

1. Jira fires a webhook on a new/updated bug ticket to
   `POST /channels/jira/webhook?secret=<JIRA_WEBHOOK_SECRET>`.
2. The Jira channel verifies the secret, normalizes the payload, and
   dispatches to the agent keyed by issue key (so each ticket is its own
   durable agent instance).
3. The agent reads the ticket, searches the GitLab projects listed in the
   jira-triage skill, decides which (if any) owns the code, and posts an
   enriched triage comment back to Jira.

## Setup

```bash
npm install
cp .env.example .env   # fill in real secrets (Bedrock uses AWS_PROFILE — no key)
```

## Run locally

```bash
# One-shot, no server (use the local CLI — `npx flue` resolves to an unrelated
# public package named "flue"). Input is just the issue key; the agent searches
# the GitLab projects listed in the skill to find the owning project:
./node_modules/.bin/flue run jira-triage \
  --input '{"message":"Triage Jira issue KAN-14."}'

# Dev server (defaults to port 3583), then POST to the Jira channel webhook
# exactly as Jira would (the channel verifies the secret and dispatches):
JIRA_WEBHOOK_SECRET=testsecret ./node_modules/.bin/flue dev --target node
# curl -XPOST 'localhost:3583/channels/jira/webhook?secret=testsecret' \
#   -H 'content-type: application/json' \
#   -d '{"webhookEvent":"jira:issue_updated","issue":{"key":"KAN-14"}}'
```

## Deploy to Kubernetes

Deployed and verified on the `workshop` EKS cluster. The app runs in its own
`flue-triage` namespace (isolated from the existing `agents` app) as a single
long-running Flue server. `k8s/base/` defines the Namespace, ServiceAccount
(IRSA), Deployment, and an internet-facing NLB Service; a gitignored
`k8s/local/` overlay patches in your account values (see below).

```bash
# 1. Build for the cluster's CPU arch (EKS nodes are amd64; an arm64 image
#    built on Apple Silicon fails with "exec format error"). Use a FRESH
#    immutable tag each time — reusing a tag leaves nodes serving the cached
#    old image.
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS \
  --password-stdin "$REGISTRY"
docker build --platform linux/amd64 -t "$REGISTRY/flue-triage:v1" .
docker push "$REGISTRY/flue-triage:v1"
# Set REGISTRY to your own ECR (or other) registry; set the matching image
# name/tag in your k8s/local/ overlay (step 3).

# 2. Secret (your chosen naming; JIRA_WEBHOOK_SECRET must match what the Jira
#    automation sends as the x-webhook-secret header / ?secret=).
kubectl -n flue-triage create secret generic flue-triage-secrets \
  --from-literal=JIRA_API_TOKEN=... \
  --from-literal=GITLAB_TOKEN=... \
  --from-literal=JIRA_WEBHOOK_SECRET=...
# AWS Bedrock auth comes from the pod's IAM role (IRSA), not a secret.

# 3. Deploy via your LOCAL overlay (your account values stay out of git).
cp k8s/local/kustomization.example.yaml k8s/local/kustomization.yaml
# edit k8s/local/kustomization.yaml — registry, IAM role ARN, Jira site, bot email
kubectl apply -k k8s/local/
kubectl -n flue-triage rollout status deploy/flue-triage
```

### Account values stay local (Kustomize)

The committed manifest (`k8s/base/`) is generic — it has placeholders, not your
account. Your real values live in `k8s/local/kustomization.yaml`, which is
**gitignored**. You never hand-edit a committed file:

- `k8s/base/` — generic Deployment + Service + ServiceAccount (committed).
- `k8s/local/kustomization.example.yaml` — the overlay **template** (committed):
  registry image, IRSA role ARN, Jira site, bot email.
- `k8s/local/kustomization.yaml` — your copy with real values (**gitignored**).

`kubectl apply -k k8s/local/` builds base + overlay. Secrets are separate — they
go in the `flue-triage-secrets` Secret created above, never in the overlay.

### Deployment notes (lessons that generalize)

- **Image:** build `--platform linux/amd64` (EKS nodes are amd64; an Apple
  Silicon build fails with `exec format error`). Deploy under a **fresh
  immutable tag** each time — reusing a tag leaves nodes serving the cached image.
- **Model:** `amazon-bedrock/us.anthropic.claude-sonnet-4-6`. Make sure the
  model specifier matches what your IAM policy allows — a policy scoped to the
  `us.` inference profile denies the `global.` one. (Model is configurable; see
  the repo-root AGENTS.md "Model & provider".)
- **Bedrock IRSA:** annotate the `flue-triage` ServiceAccount with an IAM role
  that grants `bedrock:InvokeModel*`. If you reuse a role across service
  accounts, extend its trust policy **additively** (list both
  `system:serviceaccount:<ns>:<sa>` subjects) so you don't break the existing one.
- **NLB:** internet-facing, restricted to your trigger's source range via an
  `aws-load-balancer-security-group-prefix-lists` annotation. If the trigger
  reaches you through CloudFront, that prefix-list is the AWS-managed
  CloudFront-origin list (so the NLB only accepts CloudFront, and an external
  curl to the NLB directly will time out — verify in-cluster instead).
- **Readiness probe is TCP, not HTTP** — Flue serves no `GET /` route (it 404s),
  so an httpGet probe would never pass and the Service would have no endpoints.

### Point Jira at it

In your Jira automation rule's "Send web request" action:

- **URL:** `https://<nlb-hostname>/channels/jira/webhook`
- **Header:** `x-webhook-secret: <JIRA_WEBHOOK_SECRET>`
- **Body:** unchanged — the channel only needs `{"issue":{"key":"{{issue.key}}"}}`.

The NLB is locked to Jira's source range, so verify from inside the cluster
rather than your laptop:

```bash
SEC=$(kubectl -n flue-triage get secret flue-triage-secrets \
  -o go-template='{{.data.JIRA_WEBHOOK_SECRET | base64decode}}')
kubectl -n flue-triage run trig --rm -i --restart=Never \
  --image=curlimages/curl:8.10.1 -- \
  -sS -w "\nHTTP %{http_code}\n" -XPOST \
  'http://flue-triage.flue-triage.svc.cluster.local/channels/jira/webhook' \
  -H 'content-type: application/json' -H "x-webhook-secret: $SEC" \
  -d '{"webhookEvent":"automation:label-added","issue":{"key":"KAN-14"}}'
# expect HTTP 200, then a new triage comment on KAN-14 (the run is async;
# the pod log stays quiet — the Jira comment is the ground truth).
```

### Skills in production

Skills are **fetched at boot from their own repo**, not baked into the agent
image — so they're on a separate release cycle. The base `deployment.yaml` wires
this with an init container:

- A `fetch-skills` init container `git clone`s the Skills Project (a repo whose
  root holds `.agents/skills/`) into a shared `emptyDir` volume.
- The app container mounts that volume and sets `SKILLS_DIR=/skills`. Flue
  discovers `/skills/.agents/skills/` at `init()`.

Point it at your repo + ref via the overlay (see `k8s/local/`); the init
container re-runs on every pod start, so a **rolling restart picks up new skills
with no app rebuild**. If the skills repo is **private**, the init container
reuses `GITLAB_TOKEN` from the Secret (injected into the clone URL); it's
optional, so a public repo needs no token. A skills.sh registry alternative
works too (a node image running `npx skills add <git-url> -a universal`, which
installs straight to `.agents/skills/`) — see
[docs/adding-skills.md](../../docs/adding-skills.md).

> **Why not a ConfigMap?** A ConfigMap caps at ~1 MB and flattens directory
> structure, so it can't carry a skill's `references/` subtree. `emptyDir` +
> init container has no size limit and preserves the full tree. The image still
> bakes `.agents/skills/` (via the Dockerfile) as a fallback for local
> `flue run`, but in k8s `SKILLS_DIR` overrides it.

## Docs

```bash
./node_modules/.bin/flue docs                 # browse
./node_modules/.bin/flue docs search <query>
```
