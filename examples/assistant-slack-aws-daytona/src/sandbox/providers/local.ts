import { local } from '@flue/runtime/node';
import type { SandboxProvider } from '../types.ts';

/**
 * Local provider: the agent works on the host (Lambda /tmp) filesystem/shell.
 * Zero infra, but NO isolation between channels — fine for trusted Q&A, not for
 * running untrusted code. Use daytona/ec2/k8s for real per-channel isolation.
 */
export function localProvider(): SandboxProvider {
	const cwd = process.env.SKILLS_DIR ?? process.cwd();
	return {
		name: 'local',
		forChannel() {
			return local({ cwd });
		},
	};
}
