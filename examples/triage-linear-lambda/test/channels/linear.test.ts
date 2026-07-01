import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { createLinearChannel } from '@flue/linear';
import { Hono } from 'hono';

// Run with: npm test  (node --test, no extra deps — see package.json).
// These integration tests exercise createLinearChannel's HMAC verification,
// replay-window enforcement, and dispatch routing using synthetic webhook
// payloads — no network calls, no Linear fixtures from third parties.
//
// Note: the channel returns 401 (not 403) for invalid HMAC and stale
// timestamps; 403 is used only for organizationId / webhookId mismatches.

const TEST_SECRET = 'test-webhook-secret-for-unit-tests';
const VALID_DELIVERY_ID = '00000000-0000-4000-8000-000000000001';

/** Sign a raw body string with HMAC-SHA256 and return the 64-char hex string. */
function sign(body: string): string {
	return createHmac('sha256', TEST_SECRET).update(body).digest('hex');
}

/** Base comment payload (no webhookTimestamp — caller adds it). */
const BASE_COMMENT_PAYLOAD = {
	type: 'Comment',
	action: 'create',
	organizationId: 'org-test',
	webhookId: 'webhook-test',
	actor: { id: 'user-1', name: 'Test User' },
	data: {
		id: 'comment-1',
		body: 'Please triage this issue',
		issueId: 'issue-abc',
		createdAt: '2026-01-01T00:00:00.000Z',
	},
};

interface RequestOpts {
	payload?: Record<string, unknown>;
	badSig?: boolean;
	staleTimestamp?: boolean;
	futureTimestamp?: boolean;
	deliveryId?: string;
	contentType?: string;
}

function makeRequest(opts: RequestOpts = {}): Request {
	const now = Date.now();
	let ts = now;
	if (opts.staleTimestamp) ts = now - 70_000; // > 60 s ago
	if (opts.futureTimestamp) ts = now + 70_000; // > 60 s in future

	const payload = { ...(opts.payload ?? BASE_COMMENT_PAYLOAD), webhookTimestamp: ts };
	const rawBody = JSON.stringify(payload);
	const sig = opts.badSig ? 'a'.repeat(64) : sign(rawBody);

	return new Request('http://localhost/webhook', {
		method: 'POST',
		headers: {
			'content-type': opts.contentType ?? 'application/json',
			'linear-signature': sig,
			'linear-delivery': opts.deliveryId ?? VALID_DELIVERY_ID,
		},
		body: rawBody,
	});
}

/** Build a Hono app with the channel mounted; track dispatched payloads. */
function makeTestApp(channelOpts: { organizationId?: string; webhookId?: string } = {}) {
	const dispatched: unknown[] = [];

	const channel = createLinearChannel({
		webhookSecret: TEST_SECRET,
		...channelOpts,
		// Mirror the production channel's filtering logic from src/channels/linear.ts:
		// only dispatch for Comment/create events that carry an issueId.
		async webhook({ payload }): Promise<undefined> {
			if (payload.type !== 'Comment' || !('body' in payload.data)) return undefined;
			const data = payload.data as Record<string, unknown>;
			if (payload.action !== 'create' || !data['issueId']) return undefined;
			dispatched.push(payload);
			return undefined;
		},
	});

	const app = new Hono();
	for (const route of channel.routes) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		app.post(route.path, route.handler as any);
	}

	return { app, channel, dispatched };
}

// ── HMAC / timestamp verification ───────────────────────────────────────────

test('returns 200 for valid HMAC + within-window timestamp', async () => {
	const { app } = makeTestApp();
	const res = await app.fetch(makeRequest());
	assert.equal(res.status, 200);
});

test('returns 401 for invalid HMAC signature', async () => {
	// Note: the channel returns 401 for failed signature verification (not 403).
	const { app } = makeTestApp();
	const res = await app.fetch(makeRequest({ badSig: true }));
	assert.equal(res.status, 401);
});

test('returns 401 for stale webhookTimestamp (> 60 s)', async () => {
	// Note: the channel returns 401 for expired timestamps (not 403).
	const { app } = makeTestApp();
	const res = await app.fetch(makeRequest({ staleTimestamp: true }));
	assert.equal(res.status, 401);
});

test('returns 401 for future webhookTimestamp (> 60 s ahead)', async () => {
	const { app } = makeTestApp();
	const res = await app.fetch(makeRequest({ futureTimestamp: true }));
	assert.equal(res.status, 401);
});

// ── organizationId / webhookId pin (403) ────────────────────────────────────

test('returns 403 for wrong organizationId when pinned', async () => {
	const { app } = makeTestApp({ organizationId: 'org-different' });
	const res = await app.fetch(makeRequest());
	assert.equal(res.status, 403);
});

test('returns 403 for wrong webhookId when pinned', async () => {
	const { app } = makeTestApp({ webhookId: 'webhook-different' });
	const res = await app.fetch(makeRequest());
	assert.equal(res.status, 403);
});

// ── dispatch routing ─────────────────────────────────────────────────────────

test('dispatches agent for Comment/create event with issueId', async () => {
	const { app, dispatched } = makeTestApp();
	const res = await app.fetch(makeRequest());
	assert.equal(res.status, 200);
	assert.equal(dispatched.length, 1);
	const payload = dispatched[0] as Record<string, unknown>;
	assert.equal(payload['type'], 'Comment');
	assert.equal(payload['action'], 'create');
	const data = payload['data'] as Record<string, unknown>;
	assert.equal(data['issueId'], 'issue-abc');
});

test('ignores Comment/create event without issueId', async () => {
	const { app, dispatched } = makeTestApp();
	const payloadWithoutIssueId = {
		...BASE_COMMENT_PAYLOAD,
		data: { id: 'comment-2', body: 'hello', createdAt: '2026-01-01T00:00:00.000Z' },
	};
	const res = await app.fetch(makeRequest({ payload: payloadWithoutIssueId }));
	assert.equal(res.status, 200);
	assert.equal(dispatched.length, 0, 'should not dispatch when issueId is absent');
});

test('ignores non-Comment events (no dispatch)', async () => {
	const { app, dispatched } = makeTestApp();
	const issuePayload = {
		type: 'Issue',
		action: 'create',
		organizationId: 'org-test',
		webhookId: 'webhook-test',
		actor: { id: 'user-1', name: 'Test User' },
		data: { id: 'issue-1', title: 'New issue', createdAt: '2026-01-01T00:00:00.000Z' },
	};
	const res = await app.fetch(makeRequest({ payload: issuePayload }));
	assert.equal(res.status, 200);
	assert.equal(dispatched.length, 0, 'should not dispatch for non-Comment events');
});

// ── conversationKey round-trip ───────────────────────────────────────────────

test('conversationKey round-trips through parseConversationKey', () => {
	const { channel } = makeTestApp();
	const ref = {
		type: 'issue' as const,
		organizationId: 'org-roundtrip',
		issueId: 'issue-xyz',
	};
	const key = channel.conversationKey(ref);
	assert.ok(typeof key === 'string' && key.length > 0, 'key should be a non-empty string');
	const decoded = channel.parseConversationKey(key);
	assert.deepEqual(decoded, ref);
});
