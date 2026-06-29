import { defineAgent } from '@flue/runtime';
import { replyInSlack } from '../tools/slack.ts';
import { scheduleFollowup } from '../tools/schedule.ts';
import { sandboxProvider } from '../sandbox/registry.ts';

// Channel-keyed assistant (memory per channel via src/db.ts → S3). The sandbox
// is provider-agnostic: SANDBOX_PROVIDER selects local/daytona/ec2-ssm/... — the
// agent never names a specific backend. The instance id IS the channel key (set
// by `flue run --id`), so the sandbox is created/reused per channel.
export default defineAgent(({ id }) => ({
	model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
	sandbox: sandboxProvider().forChannel(id),
	tools: [replyInSlack(), scheduleFollowup()],
}));
