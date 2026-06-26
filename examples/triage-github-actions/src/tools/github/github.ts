import { defineTool } from '@flue/runtime';
import { Octokit } from '@octokit/rest';
import * as v from 'valibot';
import { searchEnvelope, splitRepo } from './helpers.ts';

/**
 * GitHub tools. GitHub is both the work source (the issue being triaged) and
 * the code host (code, PRs, files used to enrich it), so every outbound call
 * lives in this one provider module.
 *
 * We use the official `@octokit/rest` SDK — the same client `@flue/github`'s
 * channel is built on — rather than hand-rolling fetch. There is no channel in
 * this example (the GitHub Actions workflow is the trigger), so we construct the
 * Octokit client directly here instead of importing it from a channel module.
 *
 * Auth comes from the environment at runtime — never hardcode tokens:
 *   GITHUB_TOKEN    the Actions-provided token (issues: write, contents: read),
 *                   or a PAT with `repo` scope for cross-repo reads
 *   GITHUB_API_URL  set by Actions; point it at https://<host>/api/v3 for
 *                   GitHub Enterprise. Octokit defaults to https://api.github.com.
 *
 * `owner/repo` is passed per call so the skill can search repos beyond the one
 * the workflow runs in.
 */
const octokit = new Octokit({
	auth: process.env.GITHUB_TOKEN,
	...(process.env.GITHUB_API_URL ? { baseUrl: process.env.GITHUB_API_URL } : {}),
});

// Pure helpers (repo parsing + search envelope) live in ./helpers.ts so this
// module exports only tools — the agent does `Object.values(githubTools)` to
// build its tool list, so a non-tool export here would be swept in as a tool.
// helpers.ts is where the unit tests point (see helpers.test.ts).

export const getIssue = defineTool({
	name: 'github_get_issue',
	description:
		'Fetch a GitHub issue (title, body, state, labels, author) by repo ("owner/repo") and number. Use to read the issue you are triaging.',
	input: v.object({ repo: v.string(), issueNumber: v.number() }),
	run: async ({ input }) => {
		try {
			const { data } = await octokit.rest.issues.get({
				...splitRepo(input.repo),
				issue_number: input.issueNumber,
			});
			return JSON.stringify({
				number: data.number,
				title: data.title,
				body: data.body,
				state: data.state,
				labels: data.labels.map((l) => (typeof l === 'string' ? l : l.name)),
				user: data.user?.login,
				html_url: data.html_url,
			});
		} catch (err) {
			return `GitHub get issue failed: ${String(err)}`;
		}
	},
});

export const addComment = defineTool({
	name: 'github_add_comment',
	description:
		'Add a comment to a GitHub issue. Use to post the enriched triage analysis back onto the issue. The body is GitHub-flavored Markdown.',
	input: v.object({ repo: v.string(), issueNumber: v.number(), body: v.string() }),
	run: async ({ input }) => {
		try {
			const { data } = await octokit.rest.issues.createComment({
				...splitRepo(input.repo),
				issue_number: input.issueNumber,
				body: input.body,
			});
			return `Comment ${data.id} added to ${input.repo}#${input.issueNumber}`;
		} catch (err) {
			return `GitHub add comment failed: ${String(err)}`;
		}
	},
});

export const setLabels = defineTool({
	name: 'github_set_labels',
	description:
		'Add labels to a GitHub issue (e.g. a triage category like "bug" or "area/auth"). Existing labels are kept; the given ones are added.',
	input: v.object({
		repo: v.string(),
		issueNumber: v.number(),
		labels: v.array(v.string()),
	}),
	run: async ({ input }) => {
		try {
			await octokit.rest.issues.addLabels({
				...splitRepo(input.repo),
				issue_number: input.issueNumber,
				labels: input.labels,
			});
			return `Labels ${input.labels.join(', ')} added to ${input.repo}#${input.issueNumber}`;
		} catch (err) {
			return `GitHub set labels failed: ${String(err)}`;
		}
	},
});

export const searchCode = defineTool({
	name: 'github_search_code',
	description:
		'Search code in a repo for a term (symbol, error string, file fragment). Use to locate the source an issue is likely about. Returns { total_count, returned, truncated, items: [{ path, url }] }; if truncated is true, more matches exist than were returned — narrow the query.',
	input: v.object({ repo: v.string(), query: v.string() }),
	run: async ({ input }) => {
		try {
			const { data } = await octokit.rest.search.code({
				q: `${input.query} repo:${input.repo}`,
				per_page: 20,
			});
			const items = data.items.map((m) => ({ path: m.path, url: m.html_url }));
			return JSON.stringify(searchEnvelope(data.total_count, items));
		} catch (err) {
			return `GitHub code search failed: ${String(err)}`;
		}
	},
});

export const searchPullRequests = defineTool({
	name: 'github_search_pull_requests',
	description:
		'Search pull requests in a repo by a term such as a keyword or issue number. Use to find PRs related to an issue. Returns { total_count, returned, truncated, items: [{ number, title, state, url }] }; if truncated is true, more matches exist than were returned — narrow the query.',
	input: v.object({
		repo: v.string(),
		query: v.string(),
		state: v.optional(v.picklist(['open', 'closed', 'all'])),
	}),
	run: async ({ input }) => {
		try {
			const state = input.state && input.state !== 'all' ? ` state:${input.state}` : '';
			const { data } = await octokit.rest.search.issuesAndPullRequests({
				q: `${input.query} repo:${input.repo} is:pr${state}`,
				per_page: 20,
			});
			const items = data.items.map((p) => ({
				number: p.number,
				title: p.title,
				state: p.state,
				url: p.html_url,
			}));
			return JSON.stringify(searchEnvelope(data.total_count, items));
		} catch (err) {
			return `GitHub PR search failed: ${String(err)}`;
		}
	},
});

export const getFile = defineTool({
	name: 'github_get_file',
	description:
		'Fetch the raw contents of a file from a repo at a given ref (branch, tag, or commit). Use to inspect source touched by an issue, or read repo conventions like CONTRIBUTING.md.',
	input: v.object({
		repo: v.string(),
		path: v.string(),
		ref: v.optional(v.string()),
	}),
	run: async ({ input }) => {
		try {
			const { data } = await octokit.rest.repos.getContent({
				...splitRepo(input.repo),
				path: input.path,
				...(input.ref ? { ref: input.ref } : {}),
				mediaType: { format: 'raw' },
			});
			// With the raw media type Octokit returns the file body as a string.
			return typeof data === 'string' ? data : JSON.stringify(data);
		} catch (err) {
			return `GitHub file fetch failed: ${String(err)}`;
		}
	},
});
