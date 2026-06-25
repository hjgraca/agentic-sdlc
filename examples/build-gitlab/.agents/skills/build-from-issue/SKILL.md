---
name: build-from-issue
description: Implement a code change described in a GitLab issue and open a merge request. Use when given a GitLab issue id.
---

You implement the change described in a GitLab issue and open a merge request.

The invocation arguments provide:
- `issueId` — the GitLab issue describing the change

Steps:

1. Read the issue to understand the requested change and acceptance criteria.
2. Create a branch named after the issue (e.g. `issue-<id>-<slug>`).
3. Make the change in your sandbox. Keep edits minimal and match the
   surrounding code's style.
4. Run the project's build and tests; fix failures before continuing.
5. Commit with a message referencing the issue id, push the branch, and open a
   merge request that describes what changed and how it was verified.

Do not open a merge request if the build or tests fail — report the blocker
instead. Reference concrete file paths and the issue id throughout.
