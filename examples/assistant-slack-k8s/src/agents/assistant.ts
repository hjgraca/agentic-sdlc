import { defineAgent } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import { channel, replyInThread } from '../channels/slack.ts';

// Skills and AGENTS.md are discovered by Flue at init time from the sandbox cwd:
// `<cwd>/.agents/skills/<name>/SKILL.md` and `<cwd>/AGENTS.md`. No imports, no
// instructions field — the agent's framing lives in AGENTS.md, the procedure
// lives in the slack-assistant skill. In production, mount the Skills Project
// and point SKILLS_DIR at it.
//
// Ingress and its auth live in the Slack channel (src/channels/slack.ts), which
// verifies the request signature and dispatches here keyed by thread. This
// agent is not exposed as a direct HTTP route, so it needs no route handler.
//
// The channel ↔ agent import cycle is fine: `replyInThread` and `channel` are
// read inside the deferred factory below, not at module top level.
const cwd = process.env.SKILLS_DIR ?? process.cwd();

export default defineAgent(({ id }) => ({
	model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
	sandbox: local({ cwd }),
	// Bind the reply tool to this agent's thread (recovered from its dispatch
	// id), so the model never handles channel ids or thread timestamps directly.
	tools: [replyInThread(channel.parseConversationKey(id))],
}));
