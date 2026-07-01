/**
 * Pure helpers for the validator's GitHub tools — no Octokit client or env
 * state, so they are unit-testable in isolation (see helpers.test.ts). They live
 * apart from github.ts because the agent builds its tool list with
 * `Object.values(githubTools)`; any non-tool export from that module would be
 * swept in as a bogus tool.
 */

/**
 * Split an "owner/repo" string into Octokit's { owner, repo }.
 *
 * Validates strictly: the value comes from the skill parsing the run input, so
 * a pasted URL, an extra path segment, or a missing slash are realistic.
 * Without this guard those silently yield a wrong or `undefined` coordinate and
 * every tool fails deep inside Octokit with an opaque error. We throw a clear
 * message instead; each tool's `run` catch returns it to the model.
 */
export function splitRepo(repo: string): { owner: string; repo: string } {
	const parts = repo.split('/');
	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		throw new Error(
			`Invalid repo "${repo}": expected "owner/repo" (exactly one slash, no empty segments).`,
		);
	}
	return { owner: parts[0], repo: parts[1] };
}

/**
 * Extract the spec issue number a PR closes from its body.
 *
 * The implement agent opens PRs with `Closes #<n>` (the approved-spec issue is
 * the build order). The validator needs that number to fetch the spec it must
 * check the diff against. GitHub's own closing-keyword grammar is what we mirror
 * so we find exactly what GitHub itself links: close|closes|closed|fix|fixes|
 * fixed|resolve|resolves|resolved, then `#<n>` (optionally `owner/repo#<n>`).
 *
 * Returns the FIRST match's number, or null when the body links no issue (the
 * skill then asks a human, rather than validating against a guessed spec).
 * Cross-repo references (`owner/repo#n`) are ignored — the spec lives in the
 * same repo as the PR, and matching a foreign number would validate against the
 * wrong issue.
 */
export function closingIssueNumber(body: string | null | undefined): number | null {
	if (!body) return null;
	const re =
		/\b(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\b\s*:?\s+(?:([\w.-]+\/[\w.-]+)#|#)(\d+)/gi;
	for (const m of body.matchAll(re)) {
		// m[1] is a cross-repo "owner/repo" prefix when present — skip those.
		if (m[1]) continue;
		const n = Number(m[2]);
		if (Number.isInteger(n) && n > 0) return n;
	}
	return null;
}

/**
 * The verdict the validator reaches. `matches` → the build satisfies the spec;
 * anything else is changes-requested. Kept as a string union (not a boolean) so
 * the skill can also say `uncertain` when the PR links no spec or the diff is
 * unreadable — which must NOT read as a pass.
 */
export type Verdict = 'matches' | 'changes-requested' | 'uncertain';

/**
 * Map a verdict to the GitHub review event we attempt.
 *
 * `matches` → APPROVE, `changes-requested` → REQUEST_CHANGES, `uncertain` →
 * COMMENT (no strong signal). BUT: GitHub rejects APPROVE/REQUEST_CHANGES when
 * the reviewer authored the PR (HTTP 422). Both the implement agent and this
 * validator run as github-actions[bot], so on a bot-authored implement PR the
 * strong events fail. The tool therefore treats this as the PREFERRED event and
 * falls back to COMMENT on 422 — the verdict is always stated in the review body
 * regardless, so the signal survives the downgrade. This function is the pure
 * mapping; the fallback lives in the tool.
 */
export function preferredReviewEvent(
	verdict: Verdict,
): 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' {
	switch (verdict) {
		case 'matches':
			return 'APPROVE';
		case 'changes-requested':
			return 'REQUEST_CHANGES';
		default:
			return 'COMMENT';
	}
}
