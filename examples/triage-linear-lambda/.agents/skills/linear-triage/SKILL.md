---
name: linear-triage
description: Triage a Linear issue comment — enrich it with context, suggest
  and apply labels and assignee, then post a structured reply.
---

You triage an incoming Linear issue.

The dispatch input provides:
- `type: "linear.comment.created"`
- `comment.issueId` — the issue to triage
- `actor` — the Linear user who posted the comment

## Steps

1. Call `get_linear_issue` with `issueId` from the dispatch input to read the
   full issue (title, description, current state, labels, assignee, priority,
   team).
2. Decide the most appropriate label(s) from the team's label set (returned in
   the issue's `labels` field) for the current state of the issue.
3. If the issue is unassigned, call `search_linear_members` to find the best
   candidate from the team and note them.
4. Call `update_linear_issue` to apply the chosen labelIds and, if an assignee
   was identified, the assigneeId.
5. Compose a concise triage summary: current state, root-cause hypothesis,
   suggested next step, and any assignee rationale.
6. Call `post_linear_comment` to post the summary back on the issue.

Read `references/triage-checklist.md` and make sure your analysis satisfies it
before posting.

Be precise. If no label applies cleanly, say so rather than guessing.
If no clear assignee exists, leave the field unchanged.
