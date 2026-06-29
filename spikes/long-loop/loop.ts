/**
 * Long-loop checkpoint/resume spike — local Flue durable store, no creds.
 *
 * Proves a days-long task survives as MANY short woken turns: each process does
 * exactly ONE stage, persists progress to the per-channel session, schedules the
 * next wake, and exits. A fresh process resumes at the next stage. This is the
 * "pursue a project over days" pillar — nobody pins a multi-day process; the
 * loop is checkpoint → schedule → wake → resume (true even on Cloudflare, where
 * Flue does NOT auto-resume an interrupted loop).
 *
 * Mapping to the real platform:
 *   - one `node loop.ts wake` ........ one EventBridge wake → one FIFO turn
 *   - load/save session .............. db.ts → Aurora (verified persistence)
 *   - checkpoint store ............... SessionData.metadata (app-owned, durable)
 *   - "schedule next wake" ........... in prod: CreateSchedule(at(+Δ)); here the
 *                                      npm script just invokes the next process.
 *
 * Run: `npm run spike`  (4 separate processes; data/ is reset first).
 */
import { sqlite } from '@flue/runtime/node';
import type { SessionData } from '@flue/runtime/adapter';

const DB_PATH = './data/flue.db';
const CHANNEL_ID = 'channel-C1';
const T0 = 1_700_000_000_000; // fixed clock; no Date.now in persisted payload

// The "project": an ordered plan the agent works through one stage per wake.
const PLAN = ['research', 'draft', 'review', 'publish'] as const;
type Stage = (typeof PLAN)[number];

interface Checkpoint {
	goal: string;
	completed: Stage[];        // stages finished so far (the durable progress)
	status: 'in_progress' | 'done';
	lastWakeId?: string;       // dedup: id of the last wake we processed
}

async function withSessions<T>(fn: (s: {
	save(id: string, d: SessionData): Promise<void>;
	load(id: string): Promise<SessionData | null>;
}) => Promise<T>): Promise<T> {
	const adapter = sqlite(DB_PATH);
	await adapter.migrate?.();
	const stores = await adapter.connect();
	try { return await fn(stores.executionStore.sessions); }
	finally { await adapter.close?.(); }
}

function emptySession(): SessionData {
	const iso = new Date(T0).toISOString();
	return {
		version: 8, conversationId: CHANNEL_ID, affinityKey: CHANNEL_ID,
		entries: [], leafId: null, childSessions: [], metadata: {},
		createdAt: iso, updatedAt: iso,
	};
}

function readCheckpoint(s: SessionData): Checkpoint {
	const cp = (s.metadata as { project?: Checkpoint }).project;
	return cp ?? { goal: 'Write the launch brief', completed: [], status: 'in_progress' };
}

/** One wake = do at most one stage, persist, decide whether to schedule again. */
async function wake(wakeId: string): Promise<{ didStage: Stage | null; scheduleNext: boolean }> {
	return withSessions(async (sessions) => {
		const session = (await sessions.load(CHANNEL_ID)) ?? emptySession();
		const cp = readCheckpoint(session);

		// Idempotency: SQS is at-least-once and EventBridge can double-fire, so a
		// replayed wake with the same id must be a no-op (don't double-advance).
		if (cp.lastWakeId && cp.lastWakeId === wakeId) {
			console.log(`[wake ${wakeId}] duplicate delivery — already processed; no-op.`);
			return { didStage: null, scheduleNext: cp.status !== 'done' };
		}

		if (cp.status === 'done') {
			console.log(`[wake ${wakeId}] checkpoint already done (${cp.completed.join(' → ')}); nothing to do.`);
			return { didStage: null, scheduleNext: false };
		}

		const next = PLAN[cp.completed.length] as Stage | undefined;
		if (!next) { // safety: ran past the plan
			cp.status = 'done';
		} else {
			// ── do exactly one bounded chunk of work ──
			console.log(`[wake ${wakeId}] resuming: done=[${cp.completed.join(', ') || '∅'}] → working stage "${next}"`);
			cp.completed = [...cp.completed, next];
			if (cp.completed.length === PLAN.length) cp.status = 'done';
		}
		cp.lastWakeId = wakeId; // record this wake so a replay is a no-op

		// ── checkpoint: persist progress into the per-channel session metadata ──
		const updated: SessionData = {
			...session,
			metadata: { ...session.metadata, project: cp },
			updatedAt: new Date(T0).toISOString(),
		};
		await sessions.save(CHANNEL_ID, updated);

		const scheduleNext = cp.status !== 'done';
		console.log(`[wake ${wakeId}] checkpoint saved: done=[${cp.completed.join(', ')}] status=${cp.status}` +
			(scheduleNext ? '  → schedule next wake' : '  → project COMPLETE, no further wake'));
		return { didStage: next ?? null, scheduleNext };
	});
}

async function inspect(): Promise<void> {
	await withSessions(async (sessions) => {
		const s = await sessions.load(CHANNEL_ID);
		const cp = s ? readCheckpoint(s) : null;
		const ok = !!cp && cp.status === 'done' && PLAN.every((p) => cp.completed.includes(p))
			&& cp.completed.length === PLAN.length;
		console.log('\n── final state ──');
		console.log(`   checkpoint: ${JSON.stringify(cp)}`);
		if (ok) {
			console.log('\n✅ PASS: the project advanced one stage per process, resuming from the');
			console.log('   durable checkpoint each time, and completed across 4 separate processes.');
		} else {
			console.log('\n❌ FAIL: checkpoint did not converge to a complete project.');
			process.exit(1);
		}
	});
}

const cmd = process.argv[2];
if (cmd === 'wake') {
	const wakeId = process.argv[3] ?? 'wake-0';
	const r = await wake(wakeId);
	// In production the scheduleNext=true branch would call EventBridge
	// CreateSchedule(at(now+Δ)); the npm script chains the next process instead.
	if (!r.scheduleNext) await inspect();
} else if (cmd === 'inspect') {
	await inspect();
} else {
	console.error('usage: node loop.ts wake <wakeId> | inspect');
	process.exit(2);
}
