/**
 * Verify-Lambda (zip) behind API Gateway. The always-addressable front door:
 *   1. verify the Slack request signature (HMAC-SHA256 over raw body+timestamp)
 *   2. answer Slack's url_verification challenge inline
 *   3. for an app_mention, enqueue a synthetic turn to SQS FIFO
 *      (MessageGroupId=channelId → single-writer per channel) and 200 fast
 * It NEVER runs the model — that's the consumer's job (async, after the 200).
 *
 * No deps beyond the AWS SDK (preinstalled in the Lambda Node runtime) + node:crypto.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const sqs = new SQSClient({});
const QUEUE_URL = process.env.QUEUE_URL;

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
	// Reject stale timestamps (>5 min) — replay guard.
	if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > 60 * 5) return false;
	const base = `v0:${ts}:${rawBody}`;
	const mine = `v0=${createHmac('sha256', secret).update(base).digest('hex')}`;
	const a = Buffer.from(mine);
	const b = Buffer.from(sig);
	return a.length === b.length && timingSafeEqual(a, b);
}

const resp = (statusCode, body) => ({ statusCode, body: typeof body === 'string' ? body : JSON.stringify(body) });

export async function handler(apiEvent) {
	// API Gateway (HTTP API, payload v2): raw body + lowercased headers.
	const rawBody = apiEvent.isBase64Encoded
		? Buffer.from(apiEvent.body ?? '', 'base64').toString('utf8')
		: (apiEvent.body ?? '');
	const headers = apiEvent.headers ?? {};

	const secret = await getSigningSecret();
	if (!verify(rawBody, headers, secret)) return resp(401, { error: 'bad signature' });

	let payload;
	try { payload = JSON.parse(rawBody); } catch { return resp(400, { error: 'bad json' }); }

	// Slack URL verification handshake.
	if (payload.type === 'url_verification') return resp(200, { challenge: payload.challenge });

	if (payload.type === 'event_callback' && payload.event?.type === 'app_mention') {
		const e = payload.event;
		const turn = {
			channelId: e.channel,
			teamId: payload.team_id,
			threadTs: e.thread_ts ?? e.ts,
			messageTs: e.ts,        // the mention message itself — what we react to
			text: e.text ?? '',
			eventId: payload.event_id,
		};
		await sqs.send(new SendMessageCommand({
			QueueUrl: QUEUE_URL,
			MessageBody: JSON.stringify(turn),
			MessageGroupId: turn.channelId,            // single-writer per channel
			MessageDeduplicationId: payload.event_id,  // idempotent vs Slack retries
		}));
		return resp(200, ''); // ack fast; the consumer replies asynchronously
	}

	return resp(200, ''); // ignore other event types
}
