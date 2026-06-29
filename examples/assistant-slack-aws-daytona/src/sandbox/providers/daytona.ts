import { Daytona, SandboxState, type Sandbox as DaytonaSandbox } from '@daytona/sdk';
import type { SandboxFactory, SessionEnv } from '@flue/runtime';
import type { SandboxProvider } from '../types.ts';
import { daytona } from './daytona-adapter.ts';

/**
 * Daytona provider: one remote Linux sandbox per channel (isolated shell + fs).
 * Reuses the SandboxApi adapter verified in spikes/daytona-adapter. Per-channel
 * create-or-reuse keyed by label; relies on serialized turns (SQS FIFO) so
 * concurrent calls for one channel can't race the (eventually-consistent)
 * list-by-label. Daytona's autoStop/autoDelete reap idle boxes.
 *
 * Env: DAYTONA_API_KEY, optional DAYTONA_SNAPSHOT (image with skills baked in).
 */
const LABEL = 'flue-channel';
const AUTO_STOP_MIN = 15;
const AUTO_DELETE_MIN = 60;

let client: Daytona | undefined;
function daytonaClient(): Daytona {
	client ??= new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
	return client;
}

async function boxForChannel(channelKey: string): Promise<DaytonaSandbox> {
	const c = daytonaClient();
	for await (const existing of c.list({ labels: { [LABEL]: channelKey } })) {
		if (existing.state === SandboxState.STARTED) return existing;
		await c.start(existing);
		return existing;
	}
	return c.create({
		snapshot: process.env.DAYTONA_SNAPSHOT,
		labels: { [LABEL]: channelKey },
		autoStopInterval: AUTO_STOP_MIN,
		autoDeleteInterval: AUTO_DELETE_MIN,
	});
}

export function daytonaProvider(): SandboxProvider {
	return {
		name: 'daytona',
		forChannel(channelKey: string): SandboxFactory {
			return {
				async createSessionEnv(options): Promise<SessionEnv> {
					const box = await boxForChannel(channelKey);
					return daytona(box).createSessionEnv(options);
				},
			};
		},
	};
}
