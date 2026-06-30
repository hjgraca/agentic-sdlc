// flue-blueprint: channel/slack@1
import { defineTool, dispatch } from '@flue/runtime';
import { createSlackChannel } from '@flue/slack';
import { WebClient } from '@slack/web-api';
import * as v from 'valibot';
import assistant from '../agents/assistant.ts';

/**
 * Inbound Slack ingress (the channel half of the integration). The channel is
 * inbound-only: it verifies the signature and dispatches. Outbound Web API
 * calls go through the `client` exported below, used by the agent's tools.
 *
 * SLACK_SIGNING_SECRET verifies the exact request bytes of every delivery, and
 * Slack's URL-verification challenge is acknowledged internally after that
 * check passes. SLACK_BOT_TOKEN authenticates outbound calls. Both come from
 * the environment at runtime — never hardcode them.
 */
export const client = new WebClient(requiredEnv('SLACK_BOT_TOKEN'));

export const channel = createSlackChannel({
	signingSecret: requiredEnv('SLACK_SIGNING_SECRET'),

	// Path: /channels/slack/events. Returning `undefined` yields Slack's default
	// empty 200 ack; the handler's job is the dispatch side effect, not a body.
	async events({ payload }): Promise<undefined> {
		if (payload.type !== 'event_callback') return;

		switch (payload.event.type) {
			case 'app_mention': {
				const event = payload.event;
				// Key the agent by its Slack thread so each conversation is its own
				// durable instance; replies land back in the same thread.
				const thread = {
					teamId: payload.team_id,
					channelId: event.channel,
					threadTs: event.thread_ts ?? event.ts,
				};
				await dispatch(assistant, {
					id: channel.conversationKey(thread),
					input: {
						type: 'slack.app_mention',
						eventId: payload.event_id,
						text: event.text,
					},
				});
				return;
			}
			default:
				// Filtering bot messages, subtypes, and other event families is the
				// application's job — leave it here, not in the channel factory.
				return;
		}
	},

	// This assistant only handles @-mentions, so the interactions and commands
	// surfaces are intentionally omitted — omitting a callback omits its route.
	// Enable them only when the application handles those payloads:
	//   async interactions({ payload }) { … }   // Path: /channels/slack/interactions
	//   async commands({ c, payload }) { … }     // Path: /channels/slack/commands
});

/**
 * The single outbound tool: reply in the Slack thread bound to this agent. The
 * destination (channel + thread) is bound at construction from the agent's id
 * via parseConversationKey, so the model never passes channel ids or arbitrary
 * Slack API methods as tool arguments.
 */
export function replyInThread(ref: { channelId: string; threadTs: string }) {
	return defineTool({
		name: 'reply_in_slack_thread',
		description: 'Reply in the Slack thread bound to this agent.',
		input: v.object({ text: v.pipe(v.string(), v.minLength(1)) }),
		async run({ input }) {
			const result = await client.chat.postMessage({
				channel: ref.channelId,
				thread_ts: ref.threadTs,
				text: input.text,
			});
			return {
				...(result.channel === undefined ? {} : { channel: result.channel }),
				...(result.ts === undefined ? {} : { ts: result.ts }),
			};
		},
	});
}

/**
 * Fail fast at startup if a required secret is missing, rather than
 * constructing a client with `undefined` and erroring on the first API call.
 */
function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required.`);
	return value;
}
