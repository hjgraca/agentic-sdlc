// flue-blueprint: channel/jira@1
import { type Handler } from 'hono';
import { dispatch } from '@flue/runtime';
import agent from '../agents/jira-triage.ts';

/**
 * Inbound Jira webhook ingress (the channel half of the integration). Outbound
 * Jira/GitLab/Confluence calls stay as the agent's tools — channels are
 * inbound-only.
 *
 * Jira Cloud system/automation webhooks are not HMAC-signed; the standard
 * pattern is a shared secret carried in the webhook URL or a header. We verify
 * that secret against `JIRA_WEBHOOK_SECRET` before doing any work, using a
 * length-safe constant-time compare.
 */
function timingSafeEqual(a: string, b: string): boolean {
	const enc = new TextEncoder();
	const ab = enc.encode(a);
	const bb = enc.encode(b);
	if (ab.length !== bb.length) return false;
	let diff = 0;
	for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
	return diff === 0;
}

function verifySecret(c: Parameters<Handler>[0]): boolean {
	const expected = process.env.JIRA_WEBHOOK_SECRET;
	if (!expected) return false; // fail closed: no secret configured ⇒ reject
	const provided = c.req.header('x-webhook-secret') ?? c.req.query('secret') ?? '';
	return timingSafeEqual(provided, expected);
}

/** Extract the issue key (e.g. "KAN-14") from a Jira webhook payload. */
function issueKeyOf(payload: unknown): string | undefined {
	const key = (payload as { issue?: { key?: unknown } })?.issue?.key;
	return typeof key === 'string' ? key : undefined;
}

// Path: /channels/jira/webhook
const webhook: Handler = async (c) => {
	const rawBody = await c.req.text();
	if (!verifySecret(c)) return c.json({ error: 'unauthorized' }, 401);

	let payload: unknown;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		return c.json({ error: 'invalid json' }, 400);
	}

	const issueKey = issueKeyOf(payload);
	if (!issueKey) return c.json({ error: 'no issue key in payload' }, 400);

	// Normalize: dispatch only what the agent needs, keyed by issue so each
	// ticket is its own durable agent instance. Raw payload is not forwarded.
	// Flue rejects `undefined` values in dispatch input, so include
	// `webhookEvent` only when present.
	const webhookEvent = (payload as { webhookEvent?: string }).webhookEvent;
	await dispatch(agent, {
		id: issueKey,
		input: {
			type: 'jira.webhook',
			issueKey,
			message: `Triage Jira issue ${issueKey}.`,
			...(typeof webhookEvent === 'string' ? { webhookEvent } : {}),
		},
	});

	return c.body(null, 200);
};

export const channel = {
	routes: [{ method: 'POST', path: '/webhook', handler: webhook }],
};
