import { defineAgent } from '@flue/runtime';
import { channel, replyInThread } from '../channels/slack.ts';
import { threadSandbox } from '../sandboxes/provision.ts';

// This assistant does real work inside a remote Daytona sandbox — one box per
// Slack thread — so it can run commands and operate on files, then report back.
//
// Two consequences of using a REMOTE sandbox (vs local() in the k8s example):
//  1. Each thread gets its own isolated Linux box (threadSandbox keys on the
//     dispatch id, which is the thread key). The model's commands never touch
//     the server host.
//  2. AGENTS.md + .agents/skills/ are discovered from the SANDBOX filesystem,
//     not this process's cwd. They must already exist inside the box — bake
//     them into the DAYTONA_SNAPSHOT image (see Dockerfile.sandbox). There is
//     no SKILLS_DIR / local-cwd discovery here.
//
// The channel ↔ agent import cycle is fine: `replyInThread` and `channel` are
// read inside the deferred factory below, not at module top level.

export default defineAgent(({ id }) => ({
	model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
	// Per-thread remote workspace; provisioned (or reused) on first session.
	sandbox: threadSandbox(id),
	// Bind the reply tool to this agent's thread (recovered from its dispatch
	// id), so the model never handles channel ids or thread timestamps directly.
	tools: [replyInThread(channel.parseConversationKey(id))],
}));
