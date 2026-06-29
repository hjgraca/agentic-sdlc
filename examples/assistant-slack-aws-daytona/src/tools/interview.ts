import { defineTool } from '@flue/runtime';
import { WebClient } from '@slack/web-api';
import * as v from 'valibot';
import { registerThread } from '../interview/thread-marker.ts';

/**
 * Tools for the interview / spec flow. The agent posts TOP-LEVEL in the channel
 * (visible to everyone, reads like a participant), and discussion happens in the
 * thread under that message. register_thread records that the agent's message ts
 * belongs to this conversation, so plain thread replies route back (verify-Lambda
 * looks up the marker).
 *
 * Destination + identity come from per-turn env set by the consumer:
 *   SLACK_CHANNEL_ID, SLACK_THREAD_TS (the conversation's thread root),
 *   FLUE_CONVERSATION_ID (conv:<team>:<channel>:<rootTs>).
 */
function client() {
	return new WebClient(process.env.SLACK_BOT_TOKEN);
}

/**
 * Post a top-level message in the channel (NOT inside a thread) — a question,
 * an update, or the spec. Returns the message ts, which becomes a thread root
 * people can reply under. Use this to "speak as a participant".
 */
export function postToChannel() {
	return defineTool({
		name: 'post_to_channel',
		description:
			'Post a top-level message in the channel (visible to everyone, not inside a thread). Use for questions and for the spec. Returns the message ts (the thread root others reply under).',
		input: v.object({ text: v.pipe(v.string(), v.minLength(1)) }),
		async run({ input }) {
			const res = await client().chat.postMessage({
				channel: process.env.SLACK_CHANNEL_ID!,
				text: input.text,
			});
			const ts = res.ts;
			// Register this new message as a routable thread for THIS conversation,
			// so replies under it come back to us.
			if (ts && process.env.FLUE_CONVERSATION_ID) {
				await registerThread(process.env.SLACK_CHANNEL_ID!, ts, process.env.FLUE_CONVERSATION_ID);
			}
			return { ok: res.ok === true, ...(ts ? { ts } : {}) };
		},
	});
}

/**
 * Reply inside the current conversation's thread (under the agent's anchor
 * message / the thread the user is replying in). Use for back-and-forth that
 * shouldn't spam the top-level channel.
 */
export function postInThread() {
	return defineTool({
		name: 'post_in_thread',
		description:
			'Reply inside the current thread (not a new top-level message). Use for follow-up questions and clarifications during an interview.',
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
 * Explicitly register a thread root for this conversation (usually not needed —
 * post_to_channel does it automatically — but available if the agent anchors on
 * a specific existing message).
 */
export function registerThreadTool() {
	return defineTool({
		name: 'register_thread',
		description:
			'Mark a message ts as the thread for this conversation so replies under it are routed back to you. Normally automatic via post_to_channel.',
		input: v.object({ threadTs: v.pipe(v.string(), v.minLength(1)) }),
		async run({ input }) {
			if (!process.env.FLUE_CONVERSATION_ID) return { ok: false, reason: 'no conversation id' };
			await registerThread(process.env.SLACK_CHANNEL_ID!, input.threadTs, process.env.FLUE_CONVERSATION_ID);
			return { ok: true, reason: 'registered' };
		},
	});
}
