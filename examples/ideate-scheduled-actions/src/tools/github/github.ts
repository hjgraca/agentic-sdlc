import { defineTool } from '@flue/runtime';
import { Octokit } from '@octokit/rest';
import * as v from 'valibot';
import {
	type DiscussionCategory,
	findCategoryId,
	type IdeaDiscussion,
	splitRepo,
	summariseIdeaMemory,
} from './helpers.ts';

/**
 * GitHub tools for the ideation agent. It reads the repo it surveys from the
 * local checkout + the cloned Flue source (filesystem, no tool), and WRITES its
 * ideas as GitHub **Discussions** in the "Ideas" category (ADR 0003) — so this
 * module's whole job is the discussion side.
 *
 * Discussions have **no REST API**; they are GraphQL-only. We use Octokit's
 * `graphql()` (same client family as `@flue/github`) rather than hand-rolling
 * fetch. There is no channel in this example (the schedule is the trigger).
 *
 * Two tools, by design (this agent's whole GitHub surface):
 *   - `github_list_idea_discussions` — the agent's MEMORY read (open + closed
 *     discussions in the "Ideas" category).
 *   - `github_create_idea_discussion` — opens one new idea discussion per run.
 *
 * Auth comes from the environment at runtime — never hardcode tokens:
 *   GITHUB_TOKEN    the Actions-provided token (needs `discussions: write`), or a
 *                   PAT with `repo` scope locally.
 *   GITHUB_API_URL  set by Actions; point it at https://<host>/api/v3 for GitHub
 *                   Enterprise. Octokit defaults to https://api.github.com.
 */
const octokit = new Octokit({
	auth: process.env.GITHUB_TOKEN,
	...(process.env.GITHUB_API_URL ? { baseUrl: process.env.GITHUB_API_URL } : {}),
});

// Pure helpers (repo parsing, category lookup, memory summary) live in
// ./helpers.ts so this module exports ONLY tools — the agent does
// `Object.values(githubTools)`, so a non-tool export here would be swept in as a
// bogus tool. helpers.ts is where the unit tests point (see helpers.test.ts).

// GraphQL: repo id + all discussion categories (for name→id resolution), and the
// discussions in a given category with their open/closed state. Kept as module
// constants so the query text is in one place.
const REPO_AND_CATEGORIES = `
	query ($owner: String!, $repo: String!) {
		repository(owner: $owner, name: $repo) {
			id
			discussionCategories(first: 50) {
				nodes { id name }
			}
		}
	}
`;

const DISCUSSIONS_IN_CATEGORY = `
	query ($owner: String!, $repo: String!, $categoryId: ID!, $after: String) {
		repository(owner: $owner, name: $repo) {
			discussions(first: 100, after: $after, categoryId: $categoryId) {
				nodes { number title url closed }
				pageInfo { hasNextPage endCursor }
			}
		}
	}
`;

const CREATE_DISCUSSION = `
	mutation ($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
		createDiscussion(input: {
			repositoryId: $repositoryId,
			categoryId: $categoryId,
			title: $title,
			body: $body
		}) {
			discussion { number url }
		}
	}
`;

export const listIdeaDiscussions = defineTool({
	name: 'github_list_idea_discussions',
	description:
		'List this agent\'s memory: every discussion in the given category (default "Ideas"), BOTH open and closed. Open discussions are ideas already proposed (dedup against these; they count toward the open-idea cap). Closed discussions are ideas a human rejected — NEVER re-propose those. Returns { openCount, closedCount, atCap, open: [...], closed: [...] } where each item is { number, title, state, url }. If atCap is true, do not open anything this run.',
	input: v.object({
		repo: v.string(),
		category: v.optional(v.string()),
		openCap: v.optional(v.number()),
	}),
	run: async ({ input }) => {
		try {
			const { owner, repo } = splitRepo(input.repo);
			const categoryName = input.category ?? 'Ideas';
			const openCap = input.openCap ?? 15;

			const meta: {
				repository: { id: string; discussionCategories: { nodes: DiscussionCategory[] } };
			} = await octokit.graphql(REPO_AND_CATEGORIES, { owner, repo });
			const categoryId = findCategoryId(
				meta.repository.discussionCategories.nodes,
				categoryName,
			);

			// Paginate so the memory is complete — dedup quality depends on seeing
			// the full history (open AND closed) in the category.
			const discussions: IdeaDiscussion[] = [];
			let after: string | null = null;
			do {
				const page: {
					repository: {
						discussions: {
							nodes: { number: number; title: string; url: string; closed: boolean }[];
							pageInfo: { hasNextPage: boolean; endCursor: string | null };
						};
					};
				} = await octokit.graphql(DISCUSSIONS_IN_CATEGORY, {
					owner,
					repo,
					categoryId,
					after,
				});
				for (const n of page.repository.discussions.nodes) {
					discussions.push({
						number: n.number,
						title: n.title,
						state: n.closed ? 'closed' : 'open',
						url: n.url,
					});
				}
				after = page.repository.discussions.pageInfo.hasNextPage
					? page.repository.discussions.pageInfo.endCursor
					: null;
			} while (after);

			return JSON.stringify(summariseIdeaMemory(discussions, openCap));
		} catch (err) {
			return `GitHub list idea discussions failed: ${String(err)}`;
		}
	},
});

export const createIdeaDiscussion = defineTool({
	name: 'github_create_idea_discussion',
	description:
		'Open ONE new idea as a GitHub Discussion in the given category (default "Ideas"). Use at most once per run, only after listing memory and confirming the idea is not a duplicate of any open OR closed idea and the open-idea cap is not reached. The category MUST already exist in the repo (this does not create categories). Body is GitHub-flavored Markdown — use the structured template from the skill.',
	input: v.object({
		repo: v.string(),
		title: v.string(),
		body: v.string(),
		category: v.optional(v.string()),
	}),
	run: async ({ input }) => {
		try {
			const { owner, repo } = splitRepo(input.repo);
			const categoryName = input.category ?? 'Ideas';

			const meta: {
				repository: { id: string; discussionCategories: { nodes: DiscussionCategory[] } };
			} = await octokit.graphql(REPO_AND_CATEGORIES, { owner, repo });
			const categoryId = findCategoryId(
				meta.repository.discussionCategories.nodes,
				categoryName,
			);

			const res: { createDiscussion: { discussion: { number: number; url: string } } } =
				await octokit.graphql(CREATE_DISCUSSION, {
					repositoryId: meta.repository.id,
					categoryId,
					title: input.title,
					body: input.body,
				});
			const d = res.createDiscussion.discussion;
			return `Idea opened: ${input.repo} discussion #${d.number} — ${d.url}`;
		} catch (err) {
			return `GitHub create idea discussion failed: ${String(err)}`;
		}
	},
});
