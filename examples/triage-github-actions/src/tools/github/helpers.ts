/**
 * Pure helpers for the GitHub tools. These hold no Octokit client or env state,
 * so they are unit-testable in isolation (see helpers.test.ts). They live apart
 * from github.ts because the agent builds its tool list with
 * `Object.values(githubTools)` — any non-tool export from that module would be
 * swept in as a bogus tool.
 */

/**
 * Split an "owner/repo" string into Octokit's { owner, repo }.
 *
 * Validates strictly: the value comes from the skill parsing free text out of
 * the run input, so a pasted URL, an extra path segment, or a missing slash are
 * realistic. Without this guard those silently yield a wrong or `undefined`
 * coordinate and every tool fails deep inside Octokit with an opaque error. We
 * throw a clear message instead; each tool's `run` catch returns it to the
 * model as actionable output.
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
 * Wrap search results in an envelope that carries the true match count and an
 * explicit truncation flag, so a partial page is never mistaken for full
 * coverage (a bare array hides whether N items are all of them or just page 1).
 */
export function searchEnvelope<T>(totalCount: number, items: T[]) {
	return {
		total_count: totalCount,
		returned: items.length,
		truncated: totalCount > items.length,
		items,
	};
}
