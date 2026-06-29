import { defineAgent, type ToolDefinition } from '@flue/runtime';
import { replyInSlack } from '../tools/slack.ts';
import { scheduleFollowup } from '../tools/schedule.ts';
import { sandboxProvider } from '../sandbox/registry.ts';
import { ALL_TOOLS, type ToolName } from '../governance/channel-config.ts';

// Channel-keyed assistant. Governance: the consumer resolves the channel's
// tool allowlist + optional model override and passes them via env
// (CHANNEL_TOOLS csv, CHANNEL_MODEL). The agent exposes ONLY allowed tools.
const TOOL_FACTORIES: Record<ToolName, () => ToolDefinition> = {
	reply_in_slack: replyInSlack,
	schedule_followup: scheduleFollowup,
};

function allowedFromEnv(): ToolName[] {
	const csv = process.env.CHANNEL_TOOLS;
	if (!csv) return [...ALL_TOOLS]; // no scoping configured → all tools
	const set = new Set(csv.split(',').map((s) => s.trim()));
	return ALL_TOOLS.filter((t) => set.has(t));
}

export default defineAgent(({ id }) => ({
	model: process.env.CHANNEL_MODEL ?? 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
	sandbox: sandboxProvider().forChannel(id),
	tools: allowedFromEnv().map((t) => TOOL_FACTORIES[t]()),
}));
