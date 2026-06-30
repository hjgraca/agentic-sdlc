import { defineTool } from '@flue/runtime';
import { Octokit } from '@octokit/rest';
import * as v from 'valibot';
import { type IdeaIssue, splitRepo, summariseIdeaMemory } from './helpers.ts';

/**
 * GitHub tools for the ideation agent. GitHub is both the thing the agent reads
 * (the repo it surveys, already on disk after checkout) and the thing it writes
 * (the `agent-idea` issues it files), so every outbound call lives in this one
 * provider module.
 *
 * We use the official `@octokit/rest` SDK — the same client `@flue/github`'s
 * channel is built on — rather than hand-rolling fetch. There is no channel in
 * this example (the GitHub Actions schedule is the trigger), so we construct the
 * Octokit client directly here.
 *
 * Two tools only, by design (this agent's whole GitHub surface):
 *   - `github_list_idea_issues` — the agent's MEMORY read (open + closed
 *     `agent-idea` issues). See ADR 0001.
 *   - `github_create_idea_issue` — files one new idea per run, max.
 * The example deliberately does NOT carry the triage example's read tools
 * (get_issue, search_code, …): the agent surveys the LOCAL checkout and
 * node_modules with the sandbox's own filesystem reads, not the GitHub API.
 *
 * Auth comes from the environment at runtime — never hardcode tokens:
 *   GITHUB_TOKEN    the Actions-provided token (issues: write, contents: read),
 *                   or a PAT with `repo` scope locally
 *   GITHUB_API_URL  set by Actions; point it at https://<host>/api/v3 for
 *                   GitHub Enterprise. Octokit defaults to https://api.github.com.
 */
const octokit = new Octokit({
	auth: process.env.GITHUB_TOKEN,
	...(process.env.GITHUB_API_URL ? { baseUrl: process.env.GITHUB_API_URL } : {}),
});

// Pure helpers (repo parsing + memory summary) live in ./helpers.ts so this
// module exports only tools — the agent does `Object.values(githubTools)` to
// build its tool list, so a non-tool export here would be swept in as a tool.
// helpers.ts is where the unit tests point (see helpers.test.ts).

export const listIdeaIssues = defineTool({
	name: 'github_list_idea_issues',
	description:
		'List this agent\'s memory: every issue carrying the given label (default "agent-idea"), BOTH open and closed. Open issues are ideas already proposed (dedup against these; they count toward the open-idea cap). Closed issues are ideas a human rejected — NEVER re-propose those. Returns { openCount, closedCount, atCap, open: [...], closed: [...] } where each item is { number, title, state, url }. If atCap is true, do not file anything this run.',
	input: v.object({
		repo: v.string(),
		label: v.optional(v.string()),
		openCap: v.optional(v.number()),
	}),
	run: async ({ input }) => {
		try {
			const label = input.label ?? 'agent-idea';
			const openCap = input.openCap ?? 5;
			// listForRepo with state:"all" returns open + closed; paginate so the
			// memory is complete (dedup quality depends on seeing full history).
			const raw = await octokit.paginate(octokit.rest.issues.listForRepo, {
				...splitRepo(input.repo),
				labels: label,
				state: 'all',
				per_page: 100,
			});
			const issues: IdeaIssue[] = raw
				// listForRepo returns PRs too; drop them — an idea is never a PR.
				.filter((i) => !i.pull_request)
				.map((i) => ({
					number: i.number,
					title: i.title,
					state: i.state === 'closed' ? 'closed' : 'open',
					url: i.html_url,
				}));
			return JSON.stringify(summariseIdeaMemory(issues, openCap));
		} catch (err) {
			return `GitHub list idea issues failed: ${String(err)}`;
		}
	},
});

export const createIdeaIssue = defineTool({
	name: 'github_create_idea_issue',
	description:
		'File ONE new idea as a GitHub issue, labelled "agent-idea" (or the given label). Use at most once per run, only after listing memory and confirming the idea is not a duplicate of any open OR closed idea and the open-idea cap is not reached. The label MUST already exist in the repo (this does not create labels). Body is GitHub-flavored Markdown — use the structured template from the skill.',
	input: v.object({
		repo: v.string(),
		title: v.string(),
		body: v.string(),
		label: v.optional(v.string()),
	}),
	run: async ({ input }) => {
		try {
			const { data } = await octokit.rest.issues.create({
				...splitRepo(input.repo),
				title: input.title,
				body: input.body,
				labels: [input.label ?? 'agent-idea'],
			});
			return `Idea filed: ${input.repo}#${data.number} — ${data.html_url}`;
		} catch (err) {
			return `GitHub create idea issue failed: ${String(err)}`;
		}
	},
});
