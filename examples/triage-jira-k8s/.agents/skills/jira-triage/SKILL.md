---
name: jira-triage
description: Triage a Jira bug ticket and enrich it with GitLab source-control context plus Confluence documentation standards. Use when given a Jira issue key.
---

You triage an incoming Jira bug ticket and enrich it with source-control context.

The invocation arguments provide:
- `issueKey` — the Jira issue to triage (e.g. `KAN-14`)

## GitLab projects to search

Investigate both of these projects; do not assume which one owns the code:

- `ai-tests3/team-a` — project id `83724042`
- `ai-tests3/team-b` — project id `83724073`

## Confluence documentation to apply

Read these pages and hold the team's standards in mind while triaging — the
suggested fix and next steps must conform to them:

- Coding Standards — page id `7471105`
- Testing Guide — page id `7077892`

## Steps

1. Read the ticket with `jira_get_issue` to understand the reported problem.
2. Read the Confluence pages above with `confluence_get_page` so the analysis
   reflects the team's coding standards and testing expectations.
3. For each GitLab project id above, use `gitlab_search_commits` and
   `gitlab_list_merge_requests` to find commits and MRs that mention the issue
   key, then `gitlab_get_file` to inspect source files that look relevant.
4. Compare the projects and decide which one (if any) actually contains the code
   the ticket is about.
5. Synthesize a concise triage summary: the owning project, likely root-cause
   area, the most relevant commits/MRs, suspected files, and a suggested next
   step or owner — with the fix and tests framed against the coding standards
   and testing guide.
6. Post that summary back onto the ticket with `jira_add_comment`.

Read `references/triage-checklist.md` and make sure your analysis satisfies it
before posting.

Be precise: cite concrete commit SHAs, MR numbers, and file paths, and reference
the specific standards that apply. If neither project contains relevant code, say
so plainly rather than guessing.
