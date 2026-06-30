# 0001 — The GitHub issue tracker is the ideation agent's only memory

Status: accepted · 2026-06-30

## Context

The [[Ideation Agent]] (`examples/ideate-scheduled-actions`) runs hourly as a
one-shot `flue run` on a GitHub-hosted runner. A one-shot job has no persistent
disk between runs, yet the agent must not re-propose ideas it already filed or
that a human already rejected. "What have I already said?" has to be
reconstructed each run from somewhere durable.

## Decision

Use the **GitHub issue tracker itself** as the entire memory. Each run the agent
lists `agent-idea`-labelled issues regardless of state via the `listIssues`
tool: **open** issues are "already proposed" (dedup targets that also count
toward the open-idea cap of 5); **closed** issues are "a human rejected
this — never re-propose." No external state store, no committed state file.

## Alternatives considered

- **Committed state file** (`.agent/ideas-log.json` updated via a CI commit each
  run) — rejected: introduces write-to-repo permissions and commit noise, and
  duplicates state that issues already represent.
- **External store (S3/DynamoDB)** — rejected: there are verified Flue adapters
  for both, but pulling AWS into an otherwise pure-GitHub example breaks
  "clonable with no AWS account beyond the Bedrock OIDC role," and adds infra for
  state the tracker already holds.

## Consequences

- **Closing an `agent-idea` issue is the durable feedback signal** — the closest
  thing to "self-improving" that is actually trustworthy, and it lives where
  humans already work.
- The example stays pure-GitHub: clone, set the Bedrock OIDC role, create the
  `agent-idea` label, enable the workflow.
- Dedup quality depends on the agent reading the full `agent-idea` history each
  run; issue-list paging is cheap, so no recency cap is imposed.
