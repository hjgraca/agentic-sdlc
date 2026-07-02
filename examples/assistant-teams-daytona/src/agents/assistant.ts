import { defineAgent } from '@flue/runtime';
import { channel, postTeamsMessage } from '../channels/teams.ts';
import { threadSandbox } from '../sandboxes/provision.ts';

// This assistant does real work inside a remote Daytona sandbox — one box per
// Teams conversation — so it can run commands and operate on files, then report
// back.
//
// Two consequences of using a REMOTE sandbox (vs local() in the k8s example):
//  1. Each conversation gets its own isolated Linux box (threadSandbox keys on
//     the dispatch id, which is the conversation key). The model's commands
//     never touch the server host.
//  2. AGENTS.md + .agents/skills/ are discovered from the SANDBOX filesystem,
//     not this process's cwd. They must already exist inside the box — bake
//     them into the DAYTONA_SNAPSHOT image (see Dockerfile.sandbox). There is
//     no SKILLS_DIR / local-cwd discovery here.

export default defineAgent(({ id }) => ({
	model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
	// Per-conversation remote workspace; provisioned (or reused) on first session.
	sandbox: threadSandbox(id),
	// Bind the reply tool to this agent's Teams conversation (recovered from its
	// dispatch id), so the model never handles serviceUrl or conversation ids.
	tools: [postTeamsMessage(channel.parseConversationKey(id))],
}));
