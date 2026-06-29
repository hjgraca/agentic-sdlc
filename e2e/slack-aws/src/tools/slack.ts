import { defineTool } from '@flue/runtime';
import { WebClient } from '@slack/web-api';
import * as v from 'valibot';

// One client per process; token from the environment (injected from Secrets
// Manager by the Lambda handler before the agent runs).
function client() {
	return new WebClient(process.env.SLACK_BOT_TOKEN);
}

/**
 * Reply into the Slack thread of the CURRENT turn. The agent instance is keyed
 * by CHANNEL (shared "one Claude per channel" memory — see conversationKey), so
 * the per-turn reply destination can't come from the agent id; the handler sets
 * it per invocation via SLACK_CHANNEL_ID / SLACK_THREAD_TS. The model still
 * never supplies channel ids or thread timestamps.
 */
export function replyInSlack() {
	return defineTool({
		name: 'reply_in_slack',
		description: 'Post your reply into the Slack thread you were mentioned in.',
		input: v.object({ text: v.pipe(v.string(), v.minLength(1)) }),
		async run({ input }) {
			const res = await client().chat.postMessage({
				channel: process.env.SLACK_CHANNEL_ID!,
				thread_ts: process.env.SLACK_THREAD_TS!,
				text: input.text,
			});
			return { ok: res.ok === true, ...(res.ts ? { ts: res.ts } : {}) };
		},
	});
}

/**
 * Agent instance id = one durable conversation PER CHANNEL (Claude Tag's
 * "one Claude per channel; anyone can pick up the conversation"). Memory is
 * therefore shared across all threads in the channel — not per thread.
 */
export function conversationKey(ref: { teamId: string; channelId: string }): string {
	return `slack:${ref.teamId}:${ref.channelId}`;
}
