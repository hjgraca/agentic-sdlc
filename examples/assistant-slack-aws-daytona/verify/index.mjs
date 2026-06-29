/**
 * Verify-Lambda (zip) behind API Gateway. The always-addressable front door:
 *   1. verify the Slack request signature (HMAC-SHA256 over raw body+timestamp)
 *   2. answer Slack's url_verification challenge inline
 *   3. enqueue a turn to SQS FIFO and 200 fast — for:
 *        - app_mention  → starts/continues a conversation
 *        - message      → a plain THREAD REPLY in a conversation we track
 *   It NEVER runs the model — that's the consumer's job (async, after the 200).
 *
 * Conversations are keyed per THREAD (so two specs in one channel stay separate):
 *   conversationId = `conv:<team>:<channel>:<rootTs>`.
 * A plain thread reply is only ours if a thread marker exists (written by the
 * agent's register_thread tool) at threads/<channel>/<thread_ts>.json. No
 * marker → not ours → dropped before any model cost, so the bot ignores all
 * unrelated channel chatter.
 *
 * AWS SDK v3 is preinstalled in the Lambda Node runtime.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { S3Client, GetObjectCommand, NoSuchKey } from '@aws-sdk/client-s3';

const sqs = new SQSClient({});
const s3 = new S3Client({});
const QUEUE_URL = process.env.QUEUE_URL;
const BUCKET = process.env.SESSIONS_BUCKET;

let signingSecret;
async function getSigningSecret() {
	if (signingSecret) return signingSecret;
	const sm = new SecretsManagerClient({});
	const res = await sm.send(new GetSecretValueCommand({ SecretId: process.env.SLACK_SECRET_ID }));
	signingSecret = JSON.parse(res.SecretString ?? '{}').SLACK_SIGNING_SECRET;
	if (!signingSecret) throw new Error('SLACK_SIGNING_SECRET missing from secret');
	return signingSecret;
}

function verify(rawBody, headers, secret) {
	const ts = headers['x-slack-request-timestamp'];
	const sig = headers['x-slack-signature'];
	if (!ts || !sig) return false;
	if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > 60 * 5) return false; // replay guard
	const base = `v0:${ts}:${rawBody}`;
	const mine = `v0=${createHmac('sha256', secret).update(base).digest('hex')}`;
	const a = Buffer.from(mine);
	const b = Buffer.from(sig);
	return a.length === b.length && timingSafeEqual(a, b);
}

const resp = (statusCode, body) => ({ statusCode, body: typeof body === 'string' ? body : JSON.stringify(body) });

function convId(teamId, channelId, rootTs) {
	return `conv:${teamId}:${channelId}:${rootTs}`;
}

async function lookupThread(channelId, threadTs) {
	if (!BUCKET) return null;
	try {
		const res = await s3.send(new GetObjectCommand({
			Bucket: BUCKET,
			Key: `threads/${encodeURIComponent(channelId)}/${encodeURIComponent(threadTs)}.json`,
		}));
		const body = await res.Body.transformToString();
		return JSON.parse(body); // { conversationId }
	} catch (err) {
		if (err instanceof NoSuchKey || err?.name === 'NoSuchKey') return null;
		throw err;
	}
}

async function enqueue(turn) {
	await sqs.send(new SendMessageCommand({
		QueueUrl: QUEUE_URL,
		MessageBody: JSON.stringify(turn),
		// One writer per conversation (thread) → different specs/threads run in
		// parallel, one thread's turns stay strictly ordered.
		MessageGroupId: turn.conversationId,
		MessageDeduplicationId: turn.eventId,
	}));
}

export async function handler(apiEvent) {
	const rawBody = apiEvent.isBase64Encoded
		? Buffer.from(apiEvent.body ?? '', 'base64').toString('utf8')
		: (apiEvent.body ?? '');
	const headers = apiEvent.headers ?? {};

	const secret = await getSigningSecret();
	if (!verify(rawBody, headers, secret)) return resp(401, { error: 'bad signature' });

	let payload;
	try { payload = JSON.parse(rawBody); } catch { return resp(400, { error: 'bad json' }); }

	if (payload.type === 'url_verification') return resp(200, { challenge: payload.challenge });

	if (payload.type !== 'event_callback') return resp(200, '');
	const e = payload.event ?? {};

	// (A) @mention → start/continue a conversation keyed by its thread root.
	if (e.type === 'app_mention') {
		const rootTs = e.thread_ts ?? e.ts;
		await enqueue({
			kind: 'mention',
			conversationId: convId(payload.team_id, e.channel, rootTs),
			channelId: e.channel,
			teamId: payload.team_id,
			threadTs: rootTs,
			messageTs: e.ts,
			text: e.text ?? '',
			eventId: payload.event_id,
		});
		return resp(200, '');
	}

	// (B) plain message → only a THREAD REPLY in a conversation we track.
	// OFF BY DEFAULT: subscribing to message.channels makes Slack deliver EVERY
	// message in the bot's channels (a privacy/noise concern), even though we
	// drop all but tracked-thread replies below. Default UX is @mention-to-reply
	// (a mention inside a thread already routes to that thread's conversation via
	// branch A). Opt in with ALLOW_MESSAGE_EVENTS=true + the message.channels
	// subscription only for a private/dedicated channel where that's acceptable.
	if (e.type === 'message' && process.env.ALLOW_MESSAGE_EVENTS === 'true') {
		// Drop bot/own messages and non-user subtypes (edits, joins, etc.).
		if (e.bot_id || e.subtype || e.app_id) return resp(200, '');
		// Must be a reply inside a thread (not top-level channel chatter).
		if (!e.thread_ts || e.thread_ts === e.ts) return resp(200, '');
		const marker = await lookupThread(e.channel, e.thread_ts);
		if (!marker) return resp(200, ''); // not one of our threads → ignore cheaply
		await enqueue({
			kind: 'reply',
			conversationId: marker.conversationId,
			channelId: e.channel,
			teamId: payload.team_id,
			threadTs: e.thread_ts,
			messageTs: e.ts,
			text: e.text ?? '',
			eventId: payload.event_id,
		});
		return resp(200, '');
	}

	return resp(200, ''); // ignore other event types
}
