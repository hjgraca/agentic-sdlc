/**
 * Pure helpers for the GitHub tools. These hold no Octokit client or env state,
 * so they are unit-testable in isolation (see helpers.test.ts). They live apart
 * from github.ts because the agent builds its tool list with
 * `Object.values(githubTools)` — any non-tool export from that module would be
 * swept in as a bogus tool.
 */

/**
 * Split an "owner/repo" string into { owner, repo }.
 *
 * Validates strictly: the value comes from the skill parsing the run input (or
 * $GITHUB_REPOSITORY), so a pasted URL, an extra path segment, or a missing
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

/** A discussion category as returned by the GraphQL API. */
export interface DiscussionCategory {
	id: string;
	name: string;
}

/**
 * Resolve a discussion category's node ID by name (case-insensitive).
 *
 * Discussions are created against a `categoryId`, and categories can only be
 * made by a human in repo settings (the API creates discussions, not
 * categories). So the agent resolves the ID by NAME at runtime — no opaque ID in
 * config, portable across clones. If the named category is missing (setup not
 * done), we throw a clear, actionable error listing what *does* exist rather than
 * failing cryptically inside the create mutation.
 */
export function findCategoryId(
	categories: DiscussionCategory[],
	name: string,
): string {
	const match = categories.find(
		(c) => c.name.toLowerCase() === name.toLowerCase(),
	);
	if (!match) {
		const available = categories.map((c) => c.name).join(', ') || '(none)';
		throw new Error(
			`Discussion category "${name}" not found. Create it once in repo settings (open-ended format). Available categories: ${available}.`,
		);
	}
	return match.id;
}

/**
 * One row in the agent's memory: an idea discussion reduced to what the skill
 * needs to dedup and respect human feedback.
 */
export interface IdeaDiscussion {
	number: number;
	title: string;
	state: 'open' | 'closed';
	url: string;
}

/**
 * Summarise the idea-discussion list into the memory view the skill reasons
 * over. The load-bearing rule (ADR 0001, remapped to Discussions in ADR 0003):
 * the "Ideas" category IS the agent's memory — **open** discussions are "already
 * proposed" (dedup targets that count toward the cap), **closed** discussions are
 * "a human rejected this, never re-propose."
 *
 * `atCap` is computed here (not in the skill) so the cheap-exit decision is one
 * deterministic, tested call rather than model arithmetic: an over-cap run must
 * reliably bail before any expensive survey.
 */
export function summariseIdeaMemory(
	discussions: IdeaDiscussion[],
	openCap: number,
) {
	const open = discussions.filter((d) => d.state === 'open');
	const closed = discussions.filter((d) => d.state === 'closed');
	return {
		openCount: open.length,
		closedCount: closed.length,
		atCap: open.length >= openCap,
		open,
		closed,
	};
}
