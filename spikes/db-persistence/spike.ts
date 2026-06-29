/**
 * db.ts persistence spike — does a per-channel Flue agent session survive a
 * full process restart when backed by a durable PersistenceAdapter?
 *
 * This is the load-bearing assumption under the AWS Claude-Tag plan: "one Claude
 * per channel that learns over time" requires that the conversation session,
 * keyed by channel id, reloads after the host process dies (Fargate task
 * replacement, Lambda cold start, deploy). We prove it at the STORE layer —
 * the exact mechanism Flue's db.ts wires in — with no model and no network, so
 * the result is deterministic.
 *
 * Run as two SEPARATE processes against the same SQLite file:
 *   node spike.ts write    # process A: save a 1-entry session for channel-C1
 *   node spike.ts append   # process B (fresh): load it, add a turn, save (2)
 *   node spike.ts read     # process C (fresh): load it, assert 2 entries
 * `npm run spike` chains all three with a hard `exit` between each.
 *
 * The SQLite adapter here is the local stand-in for @flue/postgres → Aurora in
 * production; both implement the same PersistenceAdapter contract, so a green
 * run here is the same code path that runs on AWS.
 */
import { sqlite } from '@flue/runtime/node';
// SessionData/SessionEntry are part of the persistence-adapter contract, so
// they're exported from the @flue/runtime/adapter subpath (not the main entry).
import type { SessionData, SessionEntry } from '@flue/runtime/adapter';

const DB_PATH = './data/flue.db';
const CHANNEL_ID = 'channel-C1'; // the per-channel agent instance id

function userEntry(id: string, parentId: string | null, text: string, ts: number): SessionEntry {
	return {
		type: 'message',
		id,
		parentId,
		timestamp: new Date(ts).toISOString(),
		message: { role: 'user', content: text, timestamp: ts },
	};
}

function newSession(entries: SessionEntry[], now: number): SessionData {
	const iso = new Date(now).toISOString();
	return {
		version: 8,
		conversationId: CHANNEL_ID,
		affinityKey: CHANNEL_ID,
		entries,
		leafId: entries.length ? entries[entries.length - 1].id : null,
		childSessions: [],
		metadata: {},
		createdAt: iso,
		updatedAt: iso,
	};
}

async function withStore<T>(fn: (sessions: {
	save(id: string, data: SessionData): Promise<void>;
	load(id: string): Promise<SessionData | null>;
}) => Promise<T>): Promise<T> {
	const adapter = sqlite(DB_PATH);
	await adapter.migrate?.();
	const stores = await adapter.connect();
	try {
		return await fn(stores.executionStore.sessions);
	} finally {
		await adapter.close?.();
	}
}

const phase = process.argv[2];
// Fixed timestamps (no Date.now in the persisted payload — keeps runs comparable).
const T0 = 1_700_000_000_000;

if (phase === 'write') {
	await withStore(async (sessions) => {
		const data = newSession([userEntry('e1', null, 'Remember: the deploy window is Tuesday 14:00 UTC.', T0)], T0);
		await sessions.save(CHANNEL_ID, data);
		console.log(`[write]  saved session ${CHANNEL_ID} with ${data.entries.length} entry`);
	});
} else if (phase === 'append') {
	await withStore(async (sessions) => {
		const loaded = await sessions.load(CHANNEL_ID);
		if (!loaded) throw new Error('[append] FAIL: session did not survive into process B');
		console.log(`[append] loaded ${loaded.entries.length} entry from a FRESH process`);
		const next = [...loaded.entries, userEntry('e2', 'e1', 'When is the deploy window again?', T0 + 60_000)];
		await sessions.save(CHANNEL_ID, newSession(next, T0 + 60_000));
		console.log(`[append] saved back ${next.length} entries`);
	});
} else if (phase === 'read') {
	await withStore(async (sessions) => {
		const loaded = await sessions.load(CHANNEL_ID);
		if (!loaded) throw new Error('[read] FAIL: session missing');
		const texts = loaded.entries.map((e: SessionEntry) => {
			if (e.type !== 'message') return '«compaction»';
			const msg = e.message;
			// AgentMessage is a union; only role:'user' carries the string content we saved.
			return 'role' in msg && msg.role === 'user' && typeof msg.content === 'string'
				? msg.content
				: '«non-user message»';
		});
		console.log(`[read]   loaded ${loaded.entries.length} entries from a FRESH process:`);
		for (const t of texts) console.log(`           • ${t}`);
		const ok =
			loaded.entries.length === 2 &&
			typeof texts[0] === 'string' &&
			texts[0].includes('Tuesday 14:00 UTC');
		if (!ok) throw new Error('[read] FAIL: turn-1 memory not recovered across restarts');
		console.log('\n✅ PASS: per-channel session persisted and reloaded across 3 separate processes.');
		console.log('   Turn 2 can see what turn 1 said — the "learns over time" pillar holds on a durable store.');
	});
} else {
	console.error('usage: node spike.ts <write|append|read>');
	process.exit(2);
}
