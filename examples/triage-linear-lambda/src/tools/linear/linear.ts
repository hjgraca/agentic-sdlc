import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { client } from '../../channels/linear.ts';

/**
 * Linear tools used to read, update, and reply to issues.
 *
 * Auth comes from the environment at runtime — never hardcode secrets:
 *   LINEAR_API_KEY   — Linear bot user's personal API key
 *   LINEAR_WEBHOOK_SECRET — verified by the channel before dispatch
 *
 * The shared `client` instance is created in `src/channels/linear.ts`
 * because both the channel (inbound) and these tools (outbound) share the
 * same LinearClient credentials.
 */

/** Read the full issue before acting — title, description, state, labels, assignee, team. */
export const getLinearIssue = defineTool({
	name: 'get_linear_issue',
	description:
		'Read a Linear issue by id. Returns title, description, state, labels, assignee, priority, and team. Call this first before making any updates.',
	input: v.object({ issueId: v.string() }),
	run: async ({ input }) => {
		const issue = await client.issue(input.issueId);
		const [labels, assignee, team, state] = await Promise.all([
			issue.labels(),
			issue.assignee,
			issue.team,
			issue.state,
		]);
		return JSON.stringify({
			id: issue.id,
			title: issue.title,
			description: issue.description ?? null,
			state: state ? { id: state.id, name: state.name } : null,
			labels: labels.nodes.map((l) => ({ id: l.id, name: l.name })),
			assignee: assignee
				? { id: assignee.id, name: assignee.name, displayName: assignee.displayName }
				: null,
			priority: issue.priority ?? null,
			team: team ? { id: team.id, name: team.name } : null,
		});
	},
});

/** Post the triage reply as a comment on the issue. */
export const postLinearComment = defineTool({
	name: 'post_linear_comment',
	description:
		'Post a comment on a Linear issue. Use to post the structured triage summary back onto the issue after completing the analysis.',
	input: v.object({ issueId: v.string(), body: v.string() }),
	run: async ({ input }) => {
		const result = await client.createComment({ issueId: input.issueId, body: input.body });
		if (!result.success) return 'post_linear_comment: failed';
		return `Comment posted${result.commentId ? ` (id: ${result.commentId})` : ''}.`;
	},
});

/** Apply label ids, assignee id, or priority to the issue. */
export const updateLinearIssue = defineTool({
	name: 'update_linear_issue',
	description:
		'Update a Linear issue: apply label ids, set an assignee id, or change priority. Use the ids returned by get_linear_issue and search_linear_members.',
	input: v.object({
		issueId: v.string(),
		labelIds: v.optional(v.array(v.string())),
		assigneeId: v.optional(v.string()),
		priority: v.optional(v.number()),
	}),
	run: async ({ input }) => {
		const { issueId, ...update } = input;
		const result = await client.updateIssue(issueId, update);
		if (!result.success) return 'update_linear_issue: failed';
		return 'Issue updated.';
	},
});

/** Resolve team member ids by name before assigning. */
export const searchLinearMembers = defineTool({
	name: 'search_linear_members',
	description:
		'Search Linear users by name, display name, or email to resolve their id before calling update_linear_issue.',
	input: v.object({ query: v.string() }),
	run: async ({ input }) => {
		const users = await client.users({
			filter: {
				or: [
					{ name: { containsIgnoreCase: input.query } },
					{ displayName: { containsIgnoreCase: input.query } },
					{ email: { containsIgnoreCase: input.query } },
				],
			},
		});
		return JSON.stringify(
			users.nodes.map((u) => ({
				id: u.id,
				name: u.name,
				displayName: u.displayName,
				email: u.email,
			})),
		);
	},
});
