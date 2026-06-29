/**
 * Self-scheduling spike — real AWS (EventBridge Scheduler + SQS FIFO + IAM),
 * no public endpoints. Proves the "takes initiative / pursue over hours-days"
 * pillar: the agent schedules a one-shot wake; later EventBridge fires it and
 * re-enqueues a synthetic turn into the SAME per-channel FIFO queue, so the wake
 * flows through the single-writer path verified in spikes/single-writer.
 *
 * Resources (all AWS-API-only, `spike-` prefixed, torn down in finally):
 *   - SQS FIFO queue (ContentBasedDeduplication on — Scheduler sets no dedup id)
 *   - IAM role trusted ONLY by scheduler.amazonaws.com, inline policy =
 *     sqs:SendMessage on the one queue ARN (least privilege)
 *   - one-shot EventBridge schedule at(~90s) targeting the queue
 */
import {
	SQSClient, CreateQueueCommand, DeleteQueueCommand, GetQueueAttributesCommand,
	ReceiveMessageCommand, DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import {
	SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand,
} from '@aws-sdk/client-scheduler';
import {
	IAMClient, CreateRoleCommand, DeleteRoleCommand,
	PutRolePolicyCommand, DeleteRolePolicyCommand,
} from '@aws-sdk/client-iam';

const REGION = process.env.AWS_REGION ?? 'us-west-2';
const STAMP = process.env.SPIKE_STAMP ?? 'local';
const QUEUE_NAME = `spike-self-sched-${STAMP}.fifo`;
const ROLE_NAME = `spike-self-sched-${STAMP}`;
const SCHEDULE_NAME = `spike-self-sched-${STAMP}`;
const POLICY_NAME = 'send-to-spike-queue';
const CHANNEL_ID = 'channel-A';

const sqs = new SQSClient({ region: REGION });
const scheduler = new SchedulerClient({ region: REGION });
const iam = new IAMClient({ region: REGION });

const log = (...a: unknown[]) => console.log(...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = true;
const check = (name: string, ok: boolean) => { log(`   ${ok ? '✅' : '❌'} ${name}`); if (!ok) pass = false; };

/** EventBridge at() = UTC, second-precision, no offset/Z suffix. */
function atExpression(msFromNow: number): string {
	const d = new Date(Date.now() + msFromNow);
	return `at(${d.toISOString().slice(0, 19)})`;
}

async function main() {
	let queueUrl: string | undefined;
	let queueArn: string | undefined;
	let roleArn: string | undefined;
	let roleCreated = false;
	let policyPut = false;
	let scheduleCreated = false;
	try {
		log(`Region ${REGION} · queue ${QUEUE_NAME} · role ${ROLE_NAME} · schedule ${SCHEDULE_NAME}`);

		// --- SQS FIFO (content-based dedup; Scheduler can't supply a dedup id) ---
		const cq = await sqs.send(new CreateQueueCommand({
			QueueName: QUEUE_NAME,
			Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'true', VisibilityTimeout: '30' },
		}));
		queueUrl = cq.QueueUrl!;
		const attrs = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }));
		queueArn = attrs.Attributes!.QueueArn!;
		log('   created FIFO queue');

		// --- IAM role: trusted only by scheduler.amazonaws.com ---
		const role = await iam.send(new CreateRoleCommand({
			RoleName: ROLE_NAME,
			AssumeRolePolicyDocument: JSON.stringify({
				Version: '2012-10-17',
				Statement: [{ Effect: 'Allow', Principal: { Service: 'scheduler.amazonaws.com' }, Action: 'sts:AssumeRole' }],
			}),
			Description: 'TEMP spike role - EventBridge Scheduler to SQS SendMessage only',
		}));
		roleArn = role.Role!.Arn!;
		roleCreated = true;
		await iam.send(new PutRolePolicyCommand({
			RoleName: ROLE_NAME, PolicyName: POLICY_NAME,
			PolicyDocument: JSON.stringify({
				Version: '2012-10-17',
				Statement: [{ Effect: 'Allow', Action: 'sqs:SendMessage', Resource: queueArn }],
			}),
		}));
		policyPut = true;
		log('   created IAM role (least privilege: sqs:SendMessage on the spike queue)');

		// --- one-shot schedule ~90s out, target = the FIFO queue ---
		const syntheticTurn = JSON.stringify({
			type: 'slack.scheduled_wake', channelId: CHANNEL_ID,
			reason: 'follow up on the quiet thread', scheduledBy: 'agent',
		});
		// New roles aren't instantly assumable; Scheduler validates the role at
		// create time, so retry through the eventual-consistency window.
		let lastErr: unknown;
		for (let i = 0; i < 12; i++) {
			try {
				await scheduler.send(new CreateScheduleCommand({
					Name: SCHEDULE_NAME,
					ScheduleExpression: atExpression(90_000),
					ScheduleExpressionTimezone: 'UTC',
					FlexibleTimeWindow: { Mode: 'OFF' },
					ActionAfterCompletion: 'NONE', // we delete it ourselves in teardown
					Target: {
						Arn: queueArn,
						RoleArn: roleArn,
						Input: syntheticTurn,
						SqsParameters: { MessageGroupId: CHANNEL_ID },
					},
				}));
				scheduleCreated = true;
				break;
			} catch (e: any) {
				lastErr = e;
				if (e.name === 'ValidationException' && /assume|role/i.test(e.message ?? '')) {
					if (i === 0) log('   waiting for IAM role to become assumable…');
					await sleep(5_000);
					continue;
				}
				throw e;
			}
		}
		if (!scheduleCreated) throw lastErr;
		log('   created one-shot schedule (~90s out) → SQS, MessageGroupId=channelId');

		// --- wait for the wake to land in the queue ---
		log('   polling the queue for the scheduled wake (up to ~3 min)…');
		let woke: { Body?: string; ReceiptHandle?: string } | undefined;
		const deadline = Date.now() + 180_000;
		while (Date.now() < deadline && !woke) {
			const r = await sqs.send(new ReceiveMessageCommand({
				QueueUrl: queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 20,
			}));
			woke = (r.Messages ?? [])[0];
		}
		check('the scheduled wake was delivered to the queue', !!woke);
		if (woke) {
			const elapsed = '(fired)';
			let parsed: any;
			try { parsed = JSON.parse(woke.Body ?? '{}'); } catch { parsed = {}; }
			log(`   received ${elapsed}: ${woke.Body}`);
			check('payload is the synthetic turn for the right channel',
				parsed.type === 'slack.scheduled_wake' && parsed.channelId === CHANNEL_ID);
			await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: woke.ReceiptHandle! }));
		}

		log(`\n${pass ? '✅ PASS' : '❌ FAIL'}: self-scheduling ${pass ? 'works' : 'did NOT work'}.`);
		if (pass) log('   An app-created EventBridge schedule re-enqueued a synthetic turn onto the\n   per-channel FIFO queue — "takes initiative / pursue over days" flows through\n   the same single-writer path.');
	} finally {
		log('\n── teardown ──');
		if (scheduleCreated) await scheduler.send(new DeleteScheduleCommand({ Name: SCHEDULE_NAME }))
			.then(() => log('   deleted schedule'), (e) => log('   schedule delete error:', e.name));
		if (policyPut) await iam.send(new DeleteRolePolicyCommand({ RoleName: ROLE_NAME, PolicyName: POLICY_NAME }))
			.then(() => log('   deleted role policy'), (e) => log('   policy delete error:', e.name));
		if (roleCreated) await iam.send(new DeleteRoleCommand({ RoleName: ROLE_NAME }))
			.then(() => log('   deleted role'), (e) => log('   role delete error:', e.name));
		if (queueUrl) await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }))
			.then(() => log('   deleted queue'), (e) => log('   queue delete error:', e.name));
	}
	process.exit(pass ? 0 : 1);
}

await main();
