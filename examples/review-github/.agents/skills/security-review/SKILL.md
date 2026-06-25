---
name: security-review
description: Review a GitHub pull request for security issues and post findings as review comments. Use when given a PR number.
---

You review a GitHub pull request for security issues and post your findings.

The invocation arguments provide:
- `pr` — the pull request number to review

Steps:

1. Fetch the PR's changed files and diff.
2. Review the changes for security issues: injection, auth/authorization gaps,
   secrets or credentials in code, unsafe deserialization, SSRF, path traversal,
   missing input validation, and insecure dependencies.
3. For each real finding, post a review comment anchored to the specific file
   and line, explaining the risk and a concrete fix.
4. If you find nothing, post a single summary comment saying the change passed
   review.

Only report issues you can justify from the diff — do not speculate. Prefer a
few high-confidence findings over many low-confidence ones. Cite the file and
line for every finding.
