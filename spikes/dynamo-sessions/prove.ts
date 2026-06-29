/**
 * Prove the DynamoDB adapter persists a session across SEPARATE connect()
 * cycles (stand-in for separate `flue run` processes), against DynamoDB Local.
 *   node prove.ts write   # connect, save a 1-entry session, close
 *   node prove.ts read    # fresh connect, load it, assert it survived
 */
import { dynamoAdapter } from './adapter.ts';
import type { SessionData, SessionEntry } from '@flue/runtime/adapter';

const ID = 'slack:T:Cchannel';
const T0 = 1_700_000_000_000;
const cfg = { tableName: 'flue-sessions', region: 'us-west-2', endpoint: 'http://localhost:8000' };

function entry(id: string, text: string): SessionEntry {
	return { type: 'message', id, parentId: null, timestamp: new Date(T0).toISOString(),
		message: { role: 'user', content: text, timestamp: T0 } };
}
function session(entries: SessionEntry[]): SessionData {
	const iso = new Date(T0).toISOString();
	return { version: 8, conversationId: ID, affinityKey: ID, entries,
		leafId: entries.at(-1)?.id ?? null, childSessions: [], metadata: {}, createdAt: iso, updatedAt: iso };
}

const phase = process.argv[2];
const adapter = dynamoAdapter(cfg);
await adapter.migrate?.();
const { executionStore } = await adapter.connect();

if (phase === 'write') {
	await executionStore.sessions.save(ID, session([entry('e1', 'deploy window is Tuesday 14:00 UTC')]));
	console.log('[write] saved session to DynamoDB');
} else if (phase === 'read') {
	const loaded = await executionStore.sessions.load(ID);
	const txt = loaded?.entries[0]?.type === 'message'
		&& 'role' in loaded.entries[0].message ? (loaded.entries[0].message as any).content : undefined;
	console.log(`[read] loaded from a FRESH adapter connect: ${loaded ? loaded.entries.length + ' entry' : 'NULL'}`);
	if (loaded && txt?.includes('Tuesday 14:00 UTC')) {
		console.log('✅ PASS: session survived across separate connect cycles via DynamoDB.');
	} else {
		console.log('❌ FAIL: did not recover the session.'); process.exit(1);
	}
}
await adapter.close?.();
