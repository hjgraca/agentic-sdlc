import type { SandboxFactory } from '@flue/runtime';

/**
 * A pluggable sandbox backend. The app talks to THIS interface, never to a
 * specific provider (Daytona/EC2/k8s/SaaS), so swapping backends is one env var.
 *
 * To add a provider you implement Flue's `SandboxApi` (just 9 methods: exec +
 * read/write/stat/readdir/exists/mkdir/rm), wrap it with
 * `createSandboxSessionEnv(api, cwd)`, and expose it here as `forChannel`.
 */
export interface SandboxProvider {
	/** Stable name (matches the SANDBOX_PROVIDER value). */
	readonly name: string;
	/**
	 * Return the Flue SandboxFactory for a given channel. Implementations that
	 * own remote compute (Daytona, EC2, pods) should create-or-reuse a workspace
	 * keyed by `channelKey` and rely on serialized turns (SQS FIFO) for safety.
	 */
	forChannel(channelKey: string): SandboxFactory;
}
