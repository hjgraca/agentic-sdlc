// flue-blueprint: channel/teams@1
import { defineTool, dispatch } from '@flue/runtime';
import { createTeamsChannel } from '@flue/teams';
import type { TeamsConversationRef } from '@flue/teams';
import { teamsClient } from '../lib/teams-client.ts';
import { stripAtMention } from '../lib/helpers.ts';
import * as v from 'valibot';
import assistant from '../agents/assistant.ts';

/**
 * Inbound Teams ingress (the channel half of the integration). The channel is
 * inbound-only: it verifies Bot Framework JWT and dispatches. Outbound Bot
 * Connector calls go through `teamsClient`, used by the agent's tools.
 *
 * TEAMS_APP_ID / TEAMS_TENANT_ID configure inbound JWT verification.
 * TEAMS_APP_PASSWORD is used only by teamsClient for outbound OAuth
 * client-credentials token requests — never passed to createTeamsChannel.
 */
export const channel = createTeamsChannel({
	appId: requiredEnv('TEAMS_APP_ID'),
	tenantId: requiredEnv('TEAMS_TENANT_ID'),
	// Optional overrides (leave unset for public Azure AD / Bot Framework defaults):
	// openIdMetadataUrl:  process.env.TEAMS_OPENID_METADATA_URL,
	// tokenIssuer:        process.env.TEAMS_TOKEN_ISSUER,

	// Path: /channels/teams/activities
	async activities({ activity }): Promise<undefined> {
		if (activity.type !== 'message') return; // ignore typing, reactions, etc.
		const ref = channel.destination(activity);
		await dispatch(assistant, {
			id: channel.conversationKey(ref),
			input: {
				type: 'teams.message',
				activityId: activity.id ?? '',
				text: stripAtMention(activity.text ?? ''),
			},
		});
	},
});

/**
 * The single outbound tool: post a message to the Teams conversation bound
 * to this agent. The ref (serviceUrl + conversationId + botId) is bound at
 * construction — the model only supplies the text.
 */
export function postTeamsMessage(ref: TeamsConversationRef) {
	return defineTool({
		name: 'post_teams_message',
		description: 'Post a message to the Teams conversation bound to this agent.',
		input: v.object({ text: v.pipe(v.string(), v.minLength(1)) }),
		async run({ input }) {
			await teamsClient.postMessage(ref, input.text);
			return { ok: true };
		},
	});
}

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required.`);
	return value;
}
