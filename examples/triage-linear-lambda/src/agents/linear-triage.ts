import { defineAgent } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as linearTools from '../tools/linear/linear.ts';

// Skills and AGENTS.md are discovered by Flue at init time from the sandbox cwd:
// `<cwd>/.agents/skills/<name>/SKILL.md` and `<cwd>/AGENTS.md`. No imports, no
// instructions field — the agent's framing lives in AGENTS.md and the triage
// procedure lives in the linear-triage skill. In production, mount the Skills
// Project and point SKILLS_DIR at it.
//
// Ingress and its auth live in the Linear channel (src/channels/linear.ts), which
// verifies the HMAC signature and dispatches here keyed by issue id. This agent
// is not exposed as a direct HTTP route; it needs no route handler of its own.
const cwd = process.env.SKILLS_DIR ?? process.cwd();

export default defineAgent(() => ({
	model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
	sandbox: local({ cwd }),
	tools: Object.values(linearTools),
}));
