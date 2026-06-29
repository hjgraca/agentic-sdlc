import type { SandboxProvider } from './types.ts';
import { localProvider } from './providers/local.ts';
import { daytonaProvider } from './providers/daytona.ts';
import { ec2SsmProvider } from './providers/ec2-ssm.ts';

// Add a provider here (one line) after implementing its module. The selected
// provider is chosen by SANDBOX_PROVIDER at runtime — no code change to switch.
const PROVIDERS: Record<string, () => SandboxProvider> = {
	local: localProvider,
	daytona: daytonaProvider,
	'ec2-ssm': ec2SsmProvider,
};

let cached: SandboxProvider | undefined;

/** The configured sandbox provider (defaults to `local`). */
export function sandboxProvider(): SandboxProvider {
	if (cached) return cached;
	const name = process.env.SANDBOX_PROVIDER ?? 'local';
	const make = PROVIDERS[name];
	if (!make) {
		throw new Error(
			`[sandbox] unknown SANDBOX_PROVIDER="${name}". Known: ${Object.keys(PROVIDERS).join(', ')}`,
		);
	}
	cached = make();
	return cached;
}
