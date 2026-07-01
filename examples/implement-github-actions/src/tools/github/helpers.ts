/**
 * Pure helpers for the implement agent's GitHub tools. No Octokit client or env
 * state, so they are unit-testable in isolation (see helpers.test.ts). They live
 * apart from github.ts because the agent builds its tool list with
 * `Object.values(githubTools)` — any non-tool export from that module would be
 * swept in as a bogus tool.
 */

/**
 * Split an "owner/repo" string into { owner, repo }.
 *
 * Validates strictly: the value comes from $GITHUB_REPOSITORY or the skill
 * parsing the run input, so a pasted URL, an extra path segment, or a missing
 * slash are realistic. Without this guard those silently yield a wrong or
 * `undefined` coordinate and every call fails deep inside the API with an opaque
 * error. We throw a clear message instead; each tool's `run` catch returns it to
 * the model as actionable output.
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
 * The stable branch name for an implement run keyed on the triggering issue.
 * Stable (not per-run) so re-triggering `implement` on the same issue CONVERGES
 * on one branch/PR instead of opening duplicates (ADR 0006). Keep in sync with
 * the branch the workflow's concurrency group is keyed on.
 */
export function implementBranch(issueNumber: number): string {
	return `implement/issue-${issueNumber}`;
}

/**
 * Decide up front what an implement run should do, from two facts: whether the
 * target example already exists on the default branch, and whether an open PR
 * already exists for this issue's branch. This is the idempotency guard (ADR
 * 0006) — computed as one tested function rather than model judgement, so
 * re-runs converge instead of multiplying:
 *
 *   - `skip`   — the example already exists on `main`; a prior PR merged. Do NOT
 *                rebuild; comment and stop.
 *   - `update` — an open PR already exists for `implement/issue-<n>`; push new
 *                work to that same branch instead of opening a duplicate.
 *   - `create` — neither exists; build fresh and open a new PR.
 */
export function decideBuildMode(opts: {
	exampleExistsOnMain: boolean;
	openPrExists: boolean;
}): 'skip' | 'update' | 'create' {
	if (opts.exampleExistsOnMain) return 'skip';
	if (opts.openPrExists) return 'update';
	return 'create';
}
