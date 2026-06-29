import { defineAgent } from '@flue/runtime';
import { local } from '@flue/runtime/node';

// Minimal slice agent: keyed by channel id (the `flue run --id` value), durable
// per-channel memory via db.ts. Uses local() to isolate the memory+keying claim
// from the Daytona sandbox (proven separately in spikes/daytona-adapter).
// AGENTS.md is discovered from cwd. Real Bedrock model.
const cwd = process.env.SKILLS_DIR ?? process.cwd();

export default defineAgent(() => ({
	model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
	sandbox: local({ cwd }),
}));
