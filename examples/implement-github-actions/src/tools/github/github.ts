import { defineTool } from '@flue/runtime';
import { Octokit } from '@octokit/rest';
import * as v from 'valibot';
import { implementBranch, splitRepo } from './helpers.ts';

/**
 * GitHub tools for the implement agent. Most of its work is SHELL, not tools:
 * with a local() sandbox it edits files and runs npm/tsc/flue/git/gh directly.
 * These tools cover only the few GitHub reads/writes that are cleaner as typed
 * calls than as shell parsing:
 *
 *   - `github_get_issue`        — read the triggering issue = the build order
 *                                 (the spec is its Markdown body).
 *   - `github_find_implement_pr`— idempotency guard: is there already an open PR
 *                                 for this issue's implement/issue-<n> branch?
 *   - `github_comment_issue`    — post the run summary (PR link + build status).
 *
 * Branch / commit / push / `gh pr create` are done in the sandbox shell (git and
 * gh are on the runner and the agent needs full git control), not here.
 *
 * Auth from the environment at runtime — never hardcode tokens:
 *   GITHUB_TOKEN    Actions-provided (contents + pull-requests + issues write),
 *                   or a PAT locally.
 *   GITHUB_API_URL  set by Actions; https://<host>/api/v3 for GHE. Octokit
 *                   defaults to https://api.github.com.
 */
const octokit = new Octokit({
	auth: process.env.GITHUB_TOKEN,
	...(process.env.GITHUB_API_URL ? { baseUrl: process.env.GITHUB_API_URL } : {}),
});

// Pure helpers (repo parsing, branch name, build-mode decision) live in
// ./helpers.ts so this module exports ONLY tools — the agent does
// `Object.values(githubTools)`, so a non-tool export here would be a bogus tool.

export const getIssue = defineTool({
	name: 'github_get_issue',
	description:
		'Read a GitHub issue by repo ("owner/repo") and number. This is your BUILD ORDER: the issue body is the approved, build-ready spec (file tree, exact wiring, test plan). Returns { number, title, body, labels, state, url }.',
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
				labels: data.labels.map((l) => (typeof l === 'string' ? l : l.name)),
				state: data.state,
				url: data.html_url,
			});
		} catch (err) {
			return `GitHub get issue failed: ${String(err)}`;
		}
	},
});

export const findImplementPr = defineTool({
	name: 'github_find_implement_pr',
	description:
		'Idempotency guard: check whether an OPEN pull request already exists for this issue\'s implement branch (implement/issue-<n>). Use this up front. Returns { branch, exists, number?, url? }. If exists is true, push your work to that same branch instead of opening a duplicate PR.',
	input: v.object({ repo: v.string(), issueNumber: v.number() }),
	run: async ({ input }) => {
		try {
			const { owner, repo } = splitRepo(input.repo);
			const branch = implementBranch(input.issueNumber);
			const { data } = await octokit.rest.pulls.list({
				owner,
				repo,
				state: 'open',
				head: `${owner}:${branch}`,
				per_page: 1,
			});
			const pr = data[0];
			return JSON.stringify({
				branch,
				exists: Boolean(pr),
				...(pr ? { number: pr.number, url: pr.html_url } : {}),
			});
		} catch (err) {
			return `GitHub find implement PR failed: ${String(err)}`;
		}
	},
});

export const commentIssue = defineTool({
	name: 'github_comment_issue',
	description:
		'Post a comment on the triggering issue — use for the run summary (the PR link and build status: green PR, draft PR + what failed, or "already exists / updated existing PR"). Body is GitHub-flavored Markdown.',
	input: v.object({ repo: v.string(), issueNumber: v.number(), body: v.string() }),
	run: async ({ input }) => {
		try {
			const { data } = await octokit.rest.issues.createComment({
				...splitRepo(input.repo),
				issue_number: input.issueNumber,
				body: input.body,
			});
			return `Comment posted: ${data.html_url}`;
		} catch (err) {
			return `GitHub comment issue failed: ${String(err)}`;
		}
	},
});
