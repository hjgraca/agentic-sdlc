# Wiring GitHub Actions → AWS Bedrock with OIDC (no stored keys)

The GitHub Actions examples (e.g.
[`spec-github-actions`](../examples/spec-github-actions/) and
[`ideate-scheduled-actions`](../examples/ideate-scheduled-actions/), plus this
repo's own root [`.github/workflows/`](../.github/workflows/) dogfood copies)
authenticate to Bedrock with **GitHub OIDC** — the Actions job mints a
short-lived token and assumes an IAM role at runtime. There are **no long-lived
AWS keys** anywhere: nothing in repo secrets, nothing on the runner.

This guide is the reproducible CLI setup. It uses placeholders only — substitute
your own values and **never commit a real account id, role ARN, or token**:

| Placeholder | What it is | How to get it |
|---|---|---|
| `<AWS_ACCOUNT_ID>` | your AWS account number | `aws sts get-caller-identity --query Account --output text` |
| `<OWNER>/<REPO>` | the GitHub repo slug | `gh repo view --json nameWithOwner -q .nameWithOwner` |
| `<AWS_REGION>` | the Bedrock region | e.g. `us-west-2` |
| `<MODEL_ID>` | the Bedrock model | e.g. `us.anthropic.claude-sonnet-4-6` |

> The commands read these from shell variables so nothing sensitive is typed
> inline. Set them once; the account id never appears in a committed file.

```bash
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
AWS_REGION="us-west-2"
MODEL_ID="us.anthropic.claude-sonnet-4-6"
ROLE_NAME="github-actions-triage-bedrock"
```

## 1. Ensure the GitHub OIDC identity provider exists (once per account)

Check first — most accounts already have it, and it is shared across all repos:

```bash
aws iam list-open-id-connect-providers \
  --query "OpenIDConnectProviderList[?contains(Arn, 'token.actions.githubusercontent.com')]"
```

If that returns an empty list, create it:

```bash
aws iam create-open-id-connect-provider \
  --url "https://token.actions.githubusercontent.com" \
  --client-id-list "sts.amazonaws.com"
```

## 2. Create the IAM role with a repo-scoped trust policy

The trust policy lets **only** this repo's Actions assume the role. `:*` allows
any branch/PR; tighten to `:ref:refs/heads/main` to restrict to the default
branch.

```bash
cat > /tmp/trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
        "StringLike":   { "token.actions.githubusercontent.com:sub": "repo:${REPO}:*" }
      }
    }
  ]
}
EOF

aws iam create-role \
  --role-name "$ROLE_NAME" \
  --assume-role-policy-document file:///tmp/trust-policy.json \
  --description "GitHub Actions OIDC role: Bedrock InvokeModel only, repo ${REPO}"
```

## 3. Attach a least-privilege Bedrock policy

Scope to `InvokeModel` on the chosen inference profile + its foundation model
only — no other Bedrock actions, no wildcards beyond region/version.

```bash
cat > /tmp/bedrock-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvokeModel",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": [
        "arn:aws:bedrock:*:${ACCOUNT_ID}:inference-profile/${MODEL_ID}*",
        "arn:aws:bedrock:*::foundation-model/${MODEL_ID#us.}*"
      ]
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "bedrock-invoke" \
  --policy-document file:///tmp/bedrock-policy.json

rm -f /tmp/trust-policy.json /tmp/bedrock-policy.json   # don't leave account id on disk
```

## 4. Set the role ARN + region as repository variables

These are **variables, not secrets** — an ARN and a region are not sensitive,
and OIDC means there is no key to store. `gh` reads the role ARN from
`get-role` so the account id is never typed inline:

```bash
ROLE_ARN="$(aws iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)"
gh variable set AWS_ROLE_ARN --repo "$REPO" --body "$ROLE_ARN"
gh variable set AWS_REGION   --repo "$REPO" --body "$AWS_REGION"

gh variable list --repo "$REPO"   # confirm
```

## 5. Create the `triage` label

The workflow fires on `issues: [labeled]` gated to this label:

```bash
gh label create triage --repo "$REPO" \
  --description "Run the Bedrock triage agent on this issue" \
  --color BFD4F2
```

## Verify

After the workflow is on the default branch, apply the `triage` label to an
issue and watch the run:

```bash
gh run list --repo "$REPO" --workflow "Issue Triage"
gh run watch  --repo "$REPO"
```

If the run fails at **Configure AWS credentials**, the trust policy subject does
not match — confirm the `repo:<OWNER>/<REPO>:*` condition and that the workflow
grants `permissions: id-token: write`. If it fails at **InvokeModel**, the role
policy resource ARNs do not match the model id, or Bedrock model access is not
enabled for that model in the region.

## What stays out of git

Account id, role ARN, and any token live only in AWS, in repo variables, or in
your shell — **never** in committed files. The committed workflow references
them indirectly via `${{ vars.AWS_ROLE_ARN }}` / `${{ vars.AWS_REGION }}` and the
auto-provided `GITHUB_TOKEN`. This mirrors the repo's secret-hygiene rule (see
[AGENTS.md](../AGENTS.md)).
