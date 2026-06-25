import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { atlassianAuthHeader } from './auth.ts';

/**
 * Jira tools used to read a ticket and write back the enriched analysis.
 *
 * Auth comes from the environment at runtime — never hardcode secrets:
 *   JIRA_BASE_URL   e.g. https://your-org.atlassian.net
 *   JIRA_EMAIL / JIRA_API_TOKEN — see ./atlassian.ts
 */
function jira(path: string, init?: RequestInit) {
	const base = process.env.JIRA_BASE_URL ?? '';
	return fetch(`${base}${path}`, {
		...init,
		headers: {
			Authorization: atlassianAuthHeader(),
			'Content-Type': 'application/json',
			Accept: 'application/json',
			...init?.headers,
		},
	});
}

export const getIssue = defineTool({
	name: 'jira_get_issue',
	description:
		'Fetch a Jira issue (summary, description, status, labels) by its key, e.g. PROJ-123. Use to read the ticket you are triaging.',
	input: v.object({ issueKey: v.string() }),
	run: async ({ input }) => {
		const res = await jira(
			`/rest/api/3/issue/${input.issueKey}?fields=summary,description,status,labels,components,priority`,
		);
		if (!res.ok) return `Jira get issue failed: ${res.status} ${await res.text()}`;
		return JSON.stringify(await res.json());
	},
});

export const addComment = defineTool({
	name: 'jira_add_comment',
	description:
		'Add a comment to a Jira issue. Use to post the enriched triage analysis back onto the ticket.',
	input: v.object({ issueKey: v.string(), body: v.string() }),
	run: async ({ input }) => {
		const res = await jira(`/rest/api/3/issue/${input.issueKey}/comment`, {
			method: 'POST',
			body: JSON.stringify({
				body: {
					type: 'doc',
					version: 1,
					content: [
						{
							type: 'paragraph',
							content: [{ type: 'text', text: input.body }],
						},
					],
				},
			}),
		});
		if (!res.ok) return `Jira add comment failed: ${res.status} ${await res.text()}`;
		return `Comment added to ${input.issueKey}`;
	},
});
