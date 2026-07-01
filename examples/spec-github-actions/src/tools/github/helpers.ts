/**
 * Pure helpers for the spec agent's GitHub tools. No Octokit client or env
 * state, so they are unit-testable in isolation (see helpers.test.ts). They live
 * apart from github.ts because the agent builds its tool list with
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

/** A comment in a discussion thread, reduced to what the reducer needs. */
export interface ThreadComment {
	/** Comment author's login. */
	author: string;
	/** True if the author is this agent (a bot) — used to ignore our own posts. */
	isAgent: boolean;
	/** Comment body (Markdown). */
	body: string;
}

/** A raw comment node (with its replies) as fetched from GraphQL. */
export interface RawComment {
	body: string;
	author: { login: string } | null;
	replies?: { body: string; author: { login: string } | null }[];
}

/**
 * Flatten a discussion's top-level comments AND their threaded replies into one
 * ordered `ThreadComment[]`. A `discussion_comment` event fires for both a
 * top-level comment and a reply, so the agent must see both — otherwise a human
 * who answers via the "Reply" link triggers a run whose thread read misses their
 * message, and the reducer wrongly decides to `wait` (silent no-op).
 *
 * Order is conversation order: each top-level comment, immediately followed by
 * its replies, then the next top-level comment. `isAgent` marks the viewer's own
 * posts so the reducer can ignore them.
 */
export function flattenThread(
	comments: RawComment[],
	viewerLogin: string,
): ThreadComment[] {
	const out: ThreadComment[] = [];
	const toEntry = (body: string, author: { login: string } | null): ThreadComment => ({
		author: author?.login ?? '(unknown)',
		isAgent: (author?.login ?? '') === viewerLogin,
		body,
	});
	for (const c of comments) {
		out.push(toEntry(c.body, c.author));
		for (const r of c.replies ?? []) out.push(toEntry(r.body, r.author));
	}
	return out;
}

/**
 * Decide, on a cold wake, what the agent should do this run by looking only at
 * the thread. This is the load-bearing reducer (ADR 0004): each `flue run` is a
 * fresh process whose entire memory is the thread, so "ask, wait, or
 * force-finalize?" must be a deterministic function of the comments.
 *
 *   - `wait`     — the newest actionable comment is the agent's own (we already
 *                  asked / posted the checkpoint); nothing new from a human.
 *                  Exit cheap, no model work.
 *   - `finalize` — the newest human comment explicitly asks to finalize
 *                  (force-finalize, ADR 0004). Skip further grilling; write spec.
 *   - `engage`   — there is a fresh human comment to act on (kick off or
 *                  continue the interview). Do the model work.
 *
 * `finalizeMarkers` are matched case-insensitively as substrings of the latest
 * human comment (e.g. "finalize", "/finalize", "looks good, finalize").
 */
export function decideAction(
	comments: ThreadComment[],
	finalizeMarkers: string[] = ['finalize', '/finalize', 'force-finalize'],
): 'engage' | 'wait' | 'finalize' {
	// The last comment NOT authored by the agent is the newest human input.
	let lastHumanIdx = -1;
	for (let i = comments.length - 1; i >= 0; i--) {
		if (!comments[i].isAgent) {
			lastHumanIdx = i;
			break;
		}
	}
	if (lastHumanIdx === -1) return 'wait'; // no human comment to act on

	// If the agent already responded AFTER the last human comment, wait.
	const agentRespondedAfter = comments
		.slice(lastHumanIdx + 1)
		.some((c) => c.isAgent);
	if (agentRespondedAfter) return 'wait';

	const latest = comments[lastHumanIdx].body.toLowerCase();
	if (finalizeMarkers.some((m) => latest.includes(m.toLowerCase()))) {
		return 'finalize';
	}
	return 'engage';
}

/**
 * Does `body` mention the agent by its handle? Gates interview KICKOFF: a
 * discussion without the `speccing` label only wakes the agent on an explicit
 * @-mention (ADR 0004). Matches `@<handle>` on a trailing boundary,
 * case-insensitive, so handle `flue-spec` does not match `@flue-spec-bot`.
 */
export function mentionsAgent(body: string, handle: string): boolean {
	const h = handle.replace(/^@/, '');
	const escaped = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`@${escaped}(?![\\w-])`, 'i').test(body);
}

/**
 * GitHub's collaborator-permission strings. The spec agent requires `write` or
 * `admin` before any model work (ADR 0004): the comment trigger is
 * world-writable, so the cheap `author_association` filter in the workflow `if:`
 * is only a first cut — this is the authoritative gate.
 */
export type RepoPermission = 'admin' | 'write' | 'read' | 'none';

/** True if the permission is enough to drive the agent (write or admin). */
export function isAuthorized(permission: RepoPermission | string): boolean {
	return permission === 'admin' || permission === 'write';
}
