import { defineTool } from '@flue/runtime';
import { Octokit } from '@octokit/rest';
import * as v from 'valibot';
import { closingIssueNumber, preferredReviewEvent, splitRepo, type Verdict } from './helpers.ts';

/**
 * GitHub tools for the validator agent. Every call is a typed Octokit request —
 * the agent reads the PR (its body, changed files, and unified diff) and the
 * linked spec issue, then submits ONE review stating whether the build matches
 * the spec. It is READ-ONLY except for that single review; it never checks out
 * or runs the PR's code, never edits files, never merges. "Does it build/test"
 * is already answered by the CI `test` job on the PR — this agent judges
 * intent-vs-spec, the thing CI can't.
 *
 * Auth from the environment at runtime — never hardcode tokens:
 *   GITHUB_TOKEN    Actions-provided (pull-requests: read+write, issues: read),
 *                   or a PAT locally.
 *   GITHUB_API_URL  set by Actions; https://<host>/api/v3 for GHE. Octokit
 *                   defaults to https://api.github.com.
 */
const octokit = new Octokit({
	auth: process.env.GITHUB_TOKEN,
	...(process.env.GITHUB_API_URL ? { baseUrl: process.env.GITHUB_API_URL } : {}),
});

// Pure helpers (repo parsing, linked-issue extraction, verdict→event mapping)
// live in ./helpers.ts so this module exports ONLY tools — the agent does
// `Object.values(githubTools)`, so a non-tool export here would be a bogus tool.

export const getPullRequest = defineTool({
	name: 'github_get_pull_request',
	description:
		'Fetch a pull request (title, body, author, labels, base/head, changed-file count) by repo ("owner/repo") and PR number. Also returns `specIssueNumber`: the spec issue this PR closes, parsed from its body (Closes #<n>) — that issue body is the spec you validate against. `specIssueNumber` is null when the PR links no issue.',
	input: v.object({ repo: v.string(), prNumber: v.number() }),
	run: async ({ input }) => {
		try {
			const { data } = await octokit.rest.pulls.get({
				...splitRepo(input.repo),
				pull_number: input.prNumber,
			});
			return JSON.stringify({
				number: data.number,
				title: data.title,
				body: data.body,
				user: data.user?.login,
				labels: data.labels.map((l) => l.name),
				state: data.state,
				draft: data.draft,
				base: data.base.ref,
				head: data.head.ref,
				changed_files: data.changed_files,
				additions: data.additions,
				deletions: data.deletions,
				html_url: data.html_url,
				specIssueNumber: closingIssueNumber(data.body),
			});
		} catch (err) {
			return `GitHub get PR failed: ${String(err)}`;
		}
	},
});

export const getIssue = defineTool({
	name: 'github_get_issue',
	description:
		'Read a GitHub issue by repo ("owner/repo") and number. Use it to fetch the linked spec issue (the one the PR closes) — its Markdown body is the approved, build-ready spec you validate the diff against. Returns { number, title, body, labels, state, url }.',
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

export const listPullRequestFiles = defineTool({
	name: 'github_list_pull_request_files',
	description:
		'List the files changed in a pull request, with per-file status and additions/deletions. Use to confirm the diff is scoped to the new example dir plus the expected wiring edits (.github/ci-examples.json, README) — a spec-conformant PR should not touch unrelated files.',
	input: v.object({ repo: v.string(), prNumber: v.number() }),
	run: async ({ input }) => {
		try {
			const { data } = await octokit.rest.pulls.listFiles({
				...splitRepo(input.repo),
				pull_number: input.prNumber,
				per_page: 100,
			});
			return JSON.stringify(
				data.map((f) => ({
					filename: f.filename,
					status: f.status,
					additions: f.additions,
					deletions: f.deletions,
				})),
			);
		} catch (err) {
			return `GitHub list PR files failed: ${String(err)}`;
		}
	},
});

export const getPullRequestDiff = defineTool({
	name: 'github_get_pull_request_diff',
	description:
		'Fetch the unified diff for a pull request (the actual added/removed lines). This is how you inspect what the code DOES — the wiring, the tool signatures, the workflow — to judge it against the spec. Large diffs are truncated; if truncated, fall back to reading specific files from the changed-files list.',
	input: v.object({ repo: v.string(), prNumber: v.number() }),
	run: async ({ input }) => {
		try {
			// The `diff` media type returns raw text, not JSON — Octokit hands it
			// back as a string on `.data` when we override Accept.
			const res = await octokit.rest.pulls.get({
				...splitRepo(input.repo),
				pull_number: input.prNumber,
				mediaType: { format: 'diff' },
			});
			const diff = res.data as unknown as string;
			const MAX = 60_000; // keep the tool result within a sane token budget
			if (diff.length > MAX) {
				return `${diff.slice(0, MAX)}\n\n[diff truncated at ${MAX} chars — read specific files from the changed-files list for the rest]`;
			}
			return diff;
		} catch (err) {
			return `GitHub get PR diff failed: ${String(err)}`;
		}
	},
});

export const getFileAtRef = defineTool({
	name: 'github_get_file_at_ref',
	description:
		"Read a single file's full contents at a git ref (use the PR head branch/sha from github_get_pull_request). Use when the diff is truncated or you need a whole file (e.g. the new agent wiring, a workflow) to judge it against the spec.",
	input: v.object({ repo: v.string(), path: v.string(), ref: v.string() }),
	run: async ({ input }) => {
		try {
			const { data } = await octokit.rest.repos.getContent({
				...splitRepo(input.repo),
				path: input.path,
				ref: input.ref,
			});
			if (Array.isArray(data) || data.type !== 'file') {
				return `Path "${input.path}" at ${input.ref} is not a file.`;
			}
			return Buffer.from(data.content, 'base64').toString('utf8');
		} catch (err) {
			return `GitHub get file failed: ${String(err)}`;
		}
	},
});

export const submitReview = defineTool({
	name: 'github_submit_review',
	description:
		'Submit your verdict as ONE pull-request review. `verdict` is "matches" (build satisfies the spec → APPROVE), "changes-requested" (discrepancies → REQUEST_CHANGES with the itemized list in the body), or "uncertain" (no linked spec / unreadable diff → a neutral COMMENT). Always put the full verdict + reasoning in `body` (GitHub-flavored Markdown). NOTE: GitHub forbids APPROVE/REQUEST_CHANGES on your OWN PR; since implement PRs are bot-authored and you are the same bot, this tool automatically downgrades to a COMMENT review on that rejection — the body (with your verdict) is posted either way, so state the verdict there.',
	input: v.object({
		repo: v.string(),
		prNumber: v.number(),
		verdict: v.picklist(['matches', 'changes-requested', 'uncertain']),
		body: v.string(),
	}),
	run: async ({ input }) => {
		const { owner, repo } = splitRepo(input.repo);
		const preferred = preferredReviewEvent(input.verdict as Verdict);
		const post = (event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT') =>
			octokit.rest.pulls.createReview({
				owner,
				repo,
				pull_number: input.prNumber,
				event,
				body: input.body,
			});
		try {
			await post(preferred);
			return `Review submitted (${preferred}) on ${input.repo}#${input.prNumber}: verdict=${input.verdict}.`;
		} catch (err) {
			// GitHub returns 422 when the reviewer authored the PR (a bot reviewing
			// its own implement PR). The verdict signal must still land, so retry
			// as a plain COMMENT — the body carries the verdict regardless.
			const status = (err as { status?: number }).status;
			if ((preferred === 'APPROVE' || preferred === 'REQUEST_CHANGES') && status === 422) {
				try {
					await post('COMMENT');
					return `Review submitted as COMMENT on ${input.repo}#${input.prNumber} (GitHub blocked ${preferred} — self-authored PR); verdict=${input.verdict} stated in the body.`;
				} catch (err2) {
					return `GitHub submit review failed on COMMENT fallback: ${String(err2)}`;
				}
			}
			return `GitHub submit review failed: ${String(err)}`;
		}
	},
});
