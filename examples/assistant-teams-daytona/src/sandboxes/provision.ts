import { Daytona, SandboxState, type Sandbox as DaytonaSandbox } from '@daytona/sdk';
import type { SandboxFactory, SessionEnv } from '@flue/runtime';
import { daytona } from './daytona.ts';

/**
 * Application-owned Daytona sandbox lifecycle: one box per Teams conversation.
 *
 * Flue's SandboxFactory has no teardown hook — the framework never tells us a
 * conversation ended — so the application owns create, reuse, and cleanup:
 *
 *   - CREATE one box per conversation, labelled with the conversation key, the
 *     first time that conversation dispatches.
 *   - REUSE it on later messages in the same conversation (look up by label);
 *     start it again if Daytona auto-stopped it in the meantime.
 *   - CLEAN UP without a hook by leaning on Daytona's own timers:
 *     `autoStopInterval` stops an idle box (stops billing compute) and
 *     `autoDeleteInterval` deletes it a while after it stops. A conversation
 *     that goes quiet therefore reaps itself; one that wakes up before deletion
 *     restarts the same box.
 *
 * The skills workspace (AGENTS.md + .agents/skills/) must live INSIDE the box,
 * because Flue discovers skills from the agent's sandbox filesystem, not the
 * host. Bake them into the snapshot named by DAYTONA_SNAPSHOT (built out of
 * band from this repo's Dockerfile.sandbox) so a fresh box already has them at
 * its work dir.
 */

const LABEL_KEY = 'flue-teams-conversation';

// Idle box stops after 15 min, then deletes 60 min after stopping. Tune to your
// cost/latency trade-off; 0 disables a timer (see the Daytona SDK docs).
const AUTO_STOP_MINUTES = 15;
const AUTO_DELETE_MINUTES = 60;

let client: Daytona | undefined;
function daytonaClient(): Daytona {
	// The SDK reads DAYTONA_API_KEY from the environment; pass it explicitly so
	// the dependency is obvious and testable.
	client ??= new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
	return client;
}

/** Daytona labels must be strings; the conversation key already is one. */
function labelFor(conversationKey: string): Record<string, string> {
	return { [LABEL_KEY]: conversationKey };
}

/**
 * Return a started Daytona sandbox dedicated to `conversationKey`, creating it
 * on first use and restarting it if it was auto-stopped. Safe to call
 * repeatedly for the same conversation *as long as the calls are serialized*
 * (Flue may call createSessionEnv more than once per id).
 *
 * CONSISTENCY CAVEAT (verified against the live Daytona API): list-by-label is
 * eventually consistent — a freshly created box takes ~1-2s to appear in
 * `list({ labels })`. So two NON-serialized calls for the same conversation
 * within that window can each see an empty list and both create a box
 * (duplicate). This is fine here because the surrounding architecture
 * serializes turns per conversation (one Teams conversation dispatches one turn
 * at a time). Do not call this concurrently for the same key without that
 * serialization.
 */
export async function sandboxForThread(conversationKey: string): Promise<DaytonaSandbox> {
	const daytona = daytonaClient();

	// Reuse an existing box for this conversation if one is still around.
	for await (const existing of daytona.list({ labels: labelFor(conversationKey) })) {
		if (existing.state === SandboxState.STARTED) return existing;
		// Auto-stopped (or mid-transition) but not yet deleted — bring it back.
		await daytona.start(existing);
		return existing;
	}

	// First message in this conversation: create a fresh box from the skills snapshot.
	return daytona.create({
		snapshot: process.env.DAYTONA_SNAPSHOT,
		labels: labelFor(conversationKey),
		autoStopInterval: AUTO_STOP_MINUTES,
		autoDeleteInterval: AUTO_DELETE_MINUTES,
	});
}

/**
 * A Flue SandboxFactory bound to one Teams conversation: provisions (or reuses)
 * that conversation's Daytona box on first session, then adapts it. Flue may
 * call createSessionEnv more than once per agent instance with the same id, and
 * sandboxForThread tolerates that by looking the box up by label.
 */
export function threadSandbox(conversationKey: string): SandboxFactory {
	return {
		async createSessionEnv(options): Promise<SessionEnv> {
			const box = await sandboxForThread(conversationKey);
			return daytona(box).createSessionEnv(options);
		},
	};
}
