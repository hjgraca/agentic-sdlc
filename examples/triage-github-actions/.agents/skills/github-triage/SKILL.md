---
name: github-triage
description: Triage an incoming GitHub issue and enrich it with source-control context — related code, pull requests, and the repo's contributing conventions. Use when given a GitHub issue reference (repo + number).
---

You triage an incoming GitHub issue and enrich it with source-control context.
A maintainer triggers you by applying the `triage` label to an issue, which runs
the agent once in GitHub Actions.

The invocation `message` names the issue to triage, e.g.
`Triage GitHub issue acme/widgets#42`. Parse the `owner/repo` and number out of
it. If the message omits the repo, default to `$GITHUB_REPOSITORY` (the repo the
workflow runs in).

## Repositories to search

Investigate the repo the issue was filed in. If the issue plausibly concerns
code that lives elsewhere, also search the related repos listed here (edit this
list for your org; leave empty to search only the issue's own repo):

- _(none — searches the issue's own repo by default)_

### Search the LOCAL checkout first — not the code-search API

This agent runs in GitHub Actions **after `actions/checkout`**, so the issue's
own repo is already on disk in the working directory. To find code in **that**
repo, search the filesystem directly (`grep`/`rg`, `read`) — do **not** use
`github_search_code` for it. The code-search API is the wrong tool here:

- It is heavily rate-limited (~10 req/min + a secondary burst limit), so two
  calls in a row return HTTP 429.
- Its index lags behind `main`, so a just-merged change returns **no results**
  even though the code is present in the checkout.
- The files are a local read away — no token round-trip needed.

Use `github_search_code` **only** for related repos that are *not* checked out
(the cross-repo case above). For the issue's own repo, prefer local `grep`/`rg`
then `read` the matches. Use `github_get_file` only to read a file at a specific
ref you don't have locally.

## Conventions to apply

Read these in-repo docs (when present) and hold the project's standards in mind
while triaging — the suggested fix and next steps must conform to them. Fetch
each with `github_get_file`:

- `CONTRIBUTING.md` — contribution + review conventions
- `AGENTS.md` or `CLAUDE.md` — repo conventions for code changes

## Steps

1. Read the issue with `github_get_issue` to understand the reported problem.
2. Read the convention docs above with `github_get_file` (skip any that 404) so
   the analysis reflects the project's standards.
3. Locate the source the issue is likely about (symbols, error strings, or file
   fragments named in the issue). For the **issue's own repo**, search the local
   checkout with `grep`/`rg` and `read` the matches — see "Search the LOCAL
   checkout first" above. Use `github_search_code` only for related repos that
   are not checked out, and `github_get_file` only to read a specific ref you do
   not have locally.
4. Use `github_search_pull_requests` to find PRs that touch the same area or
   reference the issue.
5. Synthesize a concise triage summary: the likely root-cause area, the most
   relevant files and PRs, and a suggested next step or owner — with the fix and
   tests framed against the repo's conventions.
6. Post that summary back onto the issue with `github_add_comment`.
7. Apply a triage category with `github_set_labels` (e.g. `bug`, `enhancement`,
   `needs-info`, or an `area/*` label) when you are confident; skip if unsure.

Read `references/triage-checklist.md` and make sure your analysis satisfies it
before posting.

Be precise: cite concrete file paths, PR numbers, and the specific conventions
that apply. If you cannot locate relevant code, say so plainly rather than
guessing.
