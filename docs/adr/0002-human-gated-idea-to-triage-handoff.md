# 0002 — The agent-idea → triage hand-off is human-gated, never auto-chained

Status: accepted · 2026-06-30

## Context

This repo already runs a triage agent (`.github/workflows/triage.yml`, fires on
`labeled` == `triage`). The new [[Ideation Agent]] files `agent-idea` issues.
The obvious-looking move is to auto-promote `agent-idea` → `triage` so the
triage agent enriches every idea automatically — chaining two agents through
GitHub's label system as a message bus.

## Decision

Keep the hand-off **human-gated**. The ideation agent files `agent-idea` issues;
a **human** reviews and relabels the good ones `agent-idea` → `triage`; the
existing triage workflow then picks them up **unchanged**. Auto-chaining
`agent-idea` → `triage` is an explicit **non-goal**, stated in the example's
docs.

## Alternatives considered

- **Auto-chain** (ideation agent applies `triage` directly, or a workflow
  promotes the label) — rejected on two grounds:
  1. **Frame mismatch.** The triage skill is built to enrich a *human-filed
     bug/feature report* — it searches for related existing code and PRs and
     applies CONTRIBUTING conventions. An `agent-idea` is a *researched proposal
     for a net-new example that does not exist yet*; running bug-style
     enrichment on it re-does work and produces awkward output.
  2. **No quality gate.** Auto-chaining lets unreviewed machine output drive
     more machine work, with a real risk of bot-to-bot loops.

## Consequences

- The human is the quality gate between ideation and triage — the right place
  for judgment about which ideas are worth deeper work.
- The two examples stay fully decoupled: each is independently clonable, and the
  label is the only contract between them.
- A future "evaluate a proposed idea" second stage, if wanted, should be a
  **new skill on the triage deploy shape gated to a distinct label**
  (e.g. `idea-review`) — not a reuse of the bug-triage skill.
