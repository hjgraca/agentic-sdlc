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
 * Validates strictly: the value comes from the skill parsing the run input (or
 * $GITHUB_REPOSITORY), so a pasted URL, an extra path segment, or a missing
 * slash are realistic. Without this guard those silently yield a wrong or
 * `undefined` coordinate and every tool fails deep inside Octokit with an opaque
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
 * One row in the agent's memory: an `agent-idea` issue reduced to what the skill
 * needs to dedup and respect human feedback.
 */
export interface IdeaIssue {
	number: number;
	title: string;
	state: 'open' | 'closed';
	url: string;
}

/**
 * Summarise the `agent-idea` issue list into the memory view the skill reasons
 * over. This is the load-bearing rule from ADR 0001: the issue tracker IS the
 * agent's memory — **open** ideas are "already proposed" (dedup targets that
 * count toward the cap), **closed** ideas are "a human rejected this, never
 * re-propose."
 *
 * `atCap` is computed here (not in the skill) so the cheap-exit decision is one
 * deterministic, tested call rather than model arithmetic: an over-cap hour must
 * reliably bail before any expensive survey or doc fetch.
 */
export function summariseIdeaMemory(issues: IdeaIssue[], openCap: number) {
	const open = issues.filter((i) => i.state === 'open');
	const closed = issues.filter((i) => i.state === 'closed');
	return {
		openCount: open.length,
		closedCount: closed.length,
		atCap: open.length >= openCap,
		open,
		closed,
	};
}
