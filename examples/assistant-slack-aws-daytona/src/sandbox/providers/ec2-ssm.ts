import { createSandboxSessionEnv } from '@flue/runtime';
import type { SandboxApi, SandboxFactory, FileStat, ShellResult } from '@flue/runtime';
import type { SandboxProvider } from '../types.ts';

/**
 * STUB — a worked example of how to add ANY sandbox backend (EC2 here; the same
 * shape fits a k8s pod via the exec API, Fargate, or another SaaS). A provider
 * is just a SandboxApi: implement these 9 methods against your backend, wrap
 * with createSandboxSessionEnv(api, cwd), and register one line in registry.ts.
 *
 * For EC2 you'd typically run commands via SSM SendCommand (or SSH) and move
 * files via S3 staging or `aws ssm` document. For a k8s pod, use the
 * CoreV1 `connect…Exec` endpoint and a tar stream for files. Filled in, this
 * passes Flue's 55-test store contract suite exactly like the Daytona/S3 work.
 */
function notImplemented(op: string): never {
	throw new Error(`[ec2-ssm] ${op} not implemented — this provider is a contract stub.`);
}

function ec2SsmApi(_channelKey: string): SandboxApi {
	// Replace each body with an SSM/SSH call against the channel's instance.
	return {
		async exec(_command: string, _options): Promise<ShellResult> {
			return notImplemented('exec'); // e.g. ssm.send(SendCommandCommand{...})
		},
		async readFile(_p: string): Promise<string> { return notImplemented('readFile'); },
		async readFileBuffer(_p: string): Promise<Uint8Array> { return notImplemented('readFileBuffer'); },
		async writeFile(_p: string, _c): Promise<void> { return notImplemented('writeFile'); },
		async stat(_p: string): Promise<FileStat> { return notImplemented('stat'); },
		async readdir(_p: string): Promise<string[]> { return notImplemented('readdir'); },
		async exists(_p: string): Promise<boolean> { return notImplemented('exists'); },
		async mkdir(_p: string): Promise<void> { return notImplemented('mkdir'); },
		async rm(_p: string): Promise<void> { return notImplemented('rm'); },
	};
}

export function ec2SsmProvider(): SandboxProvider {
	return {
		name: 'ec2-ssm',
		forChannel(channelKey: string): SandboxFactory {
			return {
				async createSessionEnv() {
					// Resolve/boot the channel's EC2 instance here, then:
					return createSandboxSessionEnv(ec2SsmApi(channelKey), '/home/agent');
				},
			};
		},
	};
}
