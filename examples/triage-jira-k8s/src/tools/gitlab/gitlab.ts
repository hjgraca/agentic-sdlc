import { defineTool } from '@flue/runtime';
import * as v from 'valibot';

/**
 * GitLab tools used to enrich a Jira ticket with source-control context.
 *
 * Auth comes from the environment at runtime — never hardcode tokens:
 *   GITLAB_BASE_URL   e.g. https://gitlab.com/api/v4 (cloud)
 *   GITLAB_TOKEN      a personal/project access token with read_api +
 *                     read_repository scope
 */
function gitlab(path: string, params?: Record<string, string>) {
	const base = process.env.GITLAB_BASE_URL ?? 'https://gitlab.com/api/v4';
	const url = new URL(`${base}${path}`);
	for (const [k, val] of Object.entries(params ?? {})) url.searchParams.set(k, val);
	return fetch(url, {
		headers: { 'PRIVATE-TOKEN': process.env.GITLAB_TOKEN ?? '' },
	});
}

export const searchCommits = defineTool({
	name: 'gitlab_search_commits',
	description:
		'Search a GitLab project for commits whose message references a Jira issue key (e.g. PROJ-123). Use to find code changes related to a ticket.',
	input: v.object({
		projectId: v.string(),
		issueKey: v.string(),
	}),
	run: async ({ input }) => {
		const res = await gitlab(
			`/projects/${encodeURIComponent(input.projectId)}/search`,
			{ scope: 'commits', search: input.issueKey },
		);
		if (!res.ok) return `GitLab search failed: ${res.status} ${await res.text()}`;
		return JSON.stringify(await res.json());
	},
});

export const listMergeRequests = defineTool({
	name: 'gitlab_list_merge_requests',
	description:
		'List merge requests in a GitLab project, optionally filtered by a search term such as a Jira issue key. Use to find MRs related to a ticket.',
	input: v.object({
		projectId: v.string(),
		search: v.optional(v.string()),
		state: v.optional(v.picklist(['opened', 'closed', 'merged', 'all'])),
	}),
	run: async ({ input }) => {
		const res = await gitlab(
			`/projects/${encodeURIComponent(input.projectId)}/merge_requests`,
			{
				...(input.search ? { search: input.search } : {}),
				state: input.state ?? 'all',
				per_page: '20',
			},
		);
		if (!res.ok) return `GitLab MR list failed: ${res.status} ${await res.text()}`;
		return JSON.stringify(await res.json());
	},
});

export const getFile = defineTool({
	name: 'gitlab_get_file',
	description:
		'Fetch the raw contents of a file from a GitLab project at a given ref (branch, tag, or commit). Use to inspect source touched by a ticket.',
	input: v.object({
		projectId: v.string(),
		filePath: v.string(),
		ref: v.optional(v.string()),
	}),
	run: async ({ input }) => {
		const res = await gitlab(
			`/projects/${encodeURIComponent(input.projectId)}/repository/files/${encodeURIComponent(input.filePath)}/raw`,
			{ ref: input.ref ?? 'main' },
		);
		if (!res.ok) return `GitLab file fetch failed: ${res.status} ${await res.text()}`;
		return await res.text();
	},
});
