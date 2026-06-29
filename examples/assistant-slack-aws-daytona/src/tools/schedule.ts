import { defineTool } from '@flue/runtime';
import { SchedulerClient, CreateScheduleCommand } from '@aws-sdk/client-scheduler';
import * as v from 'valibot';

/**
 * Let the agent schedule its own future wake — Claude Tag's "takes initiative /
 * pursue over hours-days." Creates a one-shot EventBridge schedule that, when it
 * fires, enqueues a `scheduled_wake` turn into the SAME per-channel FIFO queue,
 * so the wake flows through the same single-writer path as user turns. The agent
 * supplies only a delay + a note; channel
 * identity comes from env (set per-turn by the handler), never from the model.
 *
 * Env: SCHEDULE_QUEUE_ARN, SCHEDULE_ROLE_ARN, SLACK_CHANNEL_ID, SLACK_TEAM_ID,
 * SLACK_THREAD_TS, AWS_REGION.
 */
function scheduler() {
	return new SchedulerClient({});
}

// EventBridge at() = UTC, second precision, no 'Z'. Build from a base epoch ms.
function atExpression(nowMs: number, delayMinutes: number): string {
	const d = new Date(nowMs + delayMinutes * 60_000);
	return `at(${d.toISOString().slice(0, 19)})`;
}

export function scheduleFollowup() {
	return defineTool({
		name: 'schedule_followup',
		description:
			'Schedule yourself to wake up later in this channel to follow up (e.g. check on a quiet thread, continue a long task). Provide minutes from now and a short note describing what to do when you wake.',
		input: v.object({
			minutesFromNow: v.pipe(v.number(), v.minValue(1), v.maxValue(60 * 24 * 7)),
			note: v.pipe(v.string(), v.minLength(1)),
		}),
		async run({ input }) {
			const channelId = process.env.SLACK_CHANNEL_ID!;
			const teamId = process.env.SLACK_TEAM_ID!;
			const threadTs = process.env.SLACK_THREAD_TS!;
			// The synthetic turn the wake will enqueue. Marked so the consumer/agent
			// can tell a self-wake from a human mention.
			const wake = {
				channelId, teamId, threadTs, messageTs: threadTs,
				text: `[scheduled follow-up] ${input.note}`,
				eventId: `wake-${channelId}-${input.minutesFromNow}-${input.note.length}`,
				scheduledWake: true,
			};
			// Unique-ish schedule name (no Date.now in the model path; derive from inputs).
			const name = `followup-${channelId}-${input.minutesFromNow}-${input.note.length}`.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
			await scheduler().send(new CreateScheduleCommand({
				Name: name,
				ScheduleExpression: atExpression(Date.now(), input.minutesFromNow),
				ScheduleExpressionTimezone: 'UTC',
				FlexibleTimeWindow: { Mode: 'OFF' },
				ActionAfterCompletion: 'DELETE', // EventBridge cleans up the one-shot
				Target: {
					Arn: process.env.SCHEDULE_QUEUE_ARN!,
					RoleArn: process.env.SCHEDULE_ROLE_ARN!,
					Input: JSON.stringify(wake),
					SqsParameters: { MessageGroupId: channelId },
				},
			}));
			return { scheduled: true, minutesFromNow: input.minutesFromNow, name };
		},
	});
}
