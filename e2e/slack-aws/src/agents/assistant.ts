import { defineAgent, type ToolDefinition } from '@flue/runtime';
import { replyInSlack } from '../tools/slack.ts';
import { scheduleFollowup } from '../tools/schedule.ts';
import { postToChannel, postInThread, registerThreadTool } from '../tools/interview.ts';
import { sandboxProvider } from '../sandbox/registry.ts';
import { ALL_TOOLS, type ToolName } from '../governance/channel-config.ts';

// Channel/thread-keyed assistant. Governance: the consumer passes the channel's
// tool allowlist (CHANNEL_TOOLS) + optional model (CHANNEL_MODEL); the agent
// exposes ONLY allowed tools. Interview tools (post_to_channel/post_in_thread/
// register_thread) enable the multiplayer spec flow.
const TOOL_FACTORIES: Record<ToolName, () => ToolDefinition> = {
	reply_in_slack: replyInSlack,
	schedule_followup: scheduleFollowup,
	post_to_channel: postToChannel,
	post_in_thread: postInThread,
	register_thread: registerThreadTool,
};

function allowedFromEnv(): ToolName[] {
	const csv = process.env.CHANNEL_TOOLS;
	if (!csv) return [...ALL_TOOLS];
	const set = new Set(csv.split(',').map((s) => s.trim()));
	return ALL_TOOLS.filter((t) => set.has(t));
}

export default defineAgent(({ id }) => ({
	model: process.env.CHANNEL_MODEL ?? 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
	sandbox: sandboxProvider().forChannel(id),
	tools: allowedFromEnv().map((t) => TOOL_FACTORIES[t]()),
}));
