// flue-blueprint: channel/linear@1
import {
	createLinearChannel,
	type LinearConversationRef,
	type LinearWebhookPayload,
} from '@flue/linear';
import { defineTool, dispatch } from '@flue/runtime';
import { LinearClient } from '@linear/sdk';
import type { EntityWebhookPayloadWithCommentData } from '@linear/sdk/webhooks';
import * as v from 'valibot';
import agent from '../agents/linear-triage.ts';

/**
 * Inbound Linear webhook ingress (the channel half of the integration).
 * Outbound Linear API calls live in src/tools/linear/linear.ts — channels
 * are inbound-only.
 *
 * Auth: HMAC-SHA256 via `Linear-Signature` header, verified by
 * `createLinearChannel`. The webhook secret is the only auth layer
 * (Lambda Function URL uses AuthType: NONE — see README for the trade-off).
 *
 * Scope: Comment/create events only. The agent-session path (OAuth app actor)
 * is documented in the README as an upgrade path.
 */

const organizationId = optionalEnv('LINEAR_ORGANIZATION_ID');
const webhookId = optionalEnv('LINEAR_WEBHOOK_ID');

/** Shared LinearClient for both the channel and the tools. */
export const client = new LinearClient(linearCredentials());

export const channel = createLinearChannel({
	webhookSecret: requiredEnv('LINEAR_WEBHOOK_SECRET'),
	...(organizationId === undefined ? {} : { organizationId }),
	...(webhookId === undefined ? {} : { webhookId }),

	// Path: /channels/linear/webhook
	async webhook({ payload, deliveryId }): Promise<undefined> {
		if (!isCommentEvent(payload)) return undefined;

		const comment = payload.data;
		if (payload.action !== 'create' || !comment.issueId) return undefined;

		await dispatch(agent, {
			id: channel.conversationKey({
				type: 'issue',
				organizationId: payload.organizationId,
				issueId: comment.issueId,
			}),
			input: {
				type: 'linear.comment.created',
				deliveryId,
				actor: payload.actor,
				comment,
			},
		});
		return undefined;
	},
});

// Narrow Linear's native union to the Comment surface this app handles. The
// union's catch-all keeps `type` widened; combine it with the nested field.
function isCommentEvent(
	payload: LinearWebhookPayload,
): payload is EntityWebhookPayloadWithCommentData {
	return payload.type === 'Comment' && 'body' in payload.data;
}

/**
 * Factory that produces a "post to this conversation" tool bound to a specific
 * LinearConversationRef. Kept here so the channel module owns all Linear
 * identity helpers. Can be used by future agent-session–aware variants.
 */
export function postMessage(ref: LinearConversationRef) {
	return defineTool({
		name: 'post_linear_message',
		description: 'Post a message to the Linear conversation bound to this agent.',
		input: v.object({ text: v.pipe(v.string(), v.minLength(1)) }),
		async run({ input }) {
			const { text } = input;
			// Comment path only (no agent-session in this example).
			if (ref.type !== 'issue') {
				return JSON.stringify({ success: false, reason: 'agent-session path not supported' });
			}
			const result = await client.createComment({
				issueId: ref.issueId,
				...(ref.threadCommentId === undefined ? {} : { parentId: ref.threadCommentId }),
				body: text,
			});
			return JSON.stringify({
				success: result.success,
				...(result.commentId === undefined ? {} : { commentId: result.commentId }),
			});
		},
	});
}

function linearCredentials(): { apiKey: string } | { accessToken: string } {
	const apiKey = optionalEnv('LINEAR_API_KEY');
	const accessToken = optionalEnv('LINEAR_ACCESS_TOKEN');
	if (apiKey && accessToken) {
		throw new Error('Set LINEAR_API_KEY or LINEAR_ACCESS_TOKEN, not both.');
	}
	if (accessToken) return { accessToken };
	if (apiKey) return { apiKey };
	throw new Error('LINEAR_API_KEY or LINEAR_ACCESS_TOKEN is required.');
}

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required.`);
	return value;
}

function optionalEnv(name: string): string | undefined {
	return process.env[name] || undefined;
}
