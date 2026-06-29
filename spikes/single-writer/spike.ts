/**
 * Single-writer spike — real AWS (SQS FIFO + DynamoDB), no public endpoints.
 *
 * Proves the two mechanisms that synthesize a Durable Object's "one writer per
 * id" guarantee on AWS, the hard 20% of the Claude-Tag-on-AWS plan:
 *
 *   1. SQS FIFO MessageGroupId=channelId serializes TURNS within a channel
 *      (turn 2 is undeliverable until turn 1 is deleted) while letting DIFFERENT
 *      channels run in parallel.
 *   2. A DynamoDB conditional-write lease gives single-owner for the long loop
 *      that outlives an SQS message (two racers, exactly one wins; reclaimable
 *      after the lease expires).
 *
 * Creates only AWS-API-only resources (no API GW / Function URL / public policy),
 * prefixed `spike-`, and TEARS THEM DOWN in a finally block.
 */
import {
	SQSClient, CreateQueueCommand, DeleteQueueCommand, SendMessageCommand,
	ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import {
	DynamoDBClient, CreateTableCommand, DeleteTableCommand, PutItemCommand,
	waitUntilTableExists, waitUntilTableNotExists,
} from '@aws-sdk/client-dynamodb';

const REGION = process.env.AWS_REGION ?? 'us-west-2';
const STAMP = process.env.SPIKE_STAMP ?? 'local'; // pass a unique stamp per run
const QUEUE_NAME = `spike-single-writer-${STAMP}.fifo`;
const TABLE_NAME = `spike-channel-lease-${STAMP}`;

const sqs = new SQSClient({ region: REGION });
const ddb = new DynamoDBClient({ region: REGION });

const log = (...a: unknown[]) => console.log(...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = true;
const check = (name: string, ok: boolean) => {
	log(`   ${ok ? '✅' : '❌'} ${name}`);
	if (!ok) pass = false;
};

async function fifoTest(queueUrl: string) {
	log('\n── Test 1: SQS FIFO MessageGroupId serializes turns per channel ──');
	// Two turns for channel-A (same group), one for channel-B (different group).
	// ContentBasedDeduplication is off, so supply explicit dedup ids.
	const send = (group: string, body: string, dedup: string) =>
		sqs.send(new SendMessageCommand({
			QueueUrl: queueUrl, MessageBody: body,
			MessageGroupId: group, MessageDeduplicationId: dedup,
		}));
	await send('channel-A', 'A turn 1', `A1-${STAMP}`);
	await send('channel-A', 'A turn 2', `A2-${STAMP}`);
	await send('channel-B', 'B turn 1', `B1-${STAMP}`);
	log('   sent: A1, A2 (group channel-A), B1 (group channel-B)');

	// IMPORTANT FIFO nuance: a single ReceiveMessage with MaxNumberOfMessages>1
	// packs as MANY messages from the SAME group as it can into one batch — so
	// batch=10 would hand you A1 AND A2 together. The "only one in flight per
	// group" guarantee is across SUBSEQUENT receives, not within one batched call.
	// A consumer that wants strict one-turn-at-a-time per channel uses batch=1
	// (and processes its batch sequentially if it ever uses batch>1). We model
	// the realistic consumer: MaxNumberOfMessages=1.
	const recv1 = () => sqs.send(new ReceiveMessageCommand({
		QueueUrl: queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 2,
		MessageSystemAttributeNames: ['MessageGroupId'],
	}));

	// Two single-message receives: FIFO gives the head of two DISTINCT groups
	// (A's turn 1 and B's turn 1) — never A's turn 2, because A1 holds group A.
	const r1 = await recv1();
	const r2 = await recv1();
	const got = [r1.Messages?.[0], r2.Messages?.[0]].filter(Boolean) as { Body?: string; ReceiptHandle?: string }[];
	const bodies = got.map((m) => m.Body).sort();
	log(`   two batch=1 receives → [${bodies.join(', ')}]`);
	check('the two heads delivered are A turn 1 + B turn 1 (cross-channel parallelism)',
		bodies.length === 2 && bodies.includes('A turn 1') && bodies.includes('B turn 1'));
	check('A turn 2 is NOT delivered while A turn 1 is in flight',
		!bodies.includes('A turn 2'));

	// A third receive without deleting A1 → channel-A still blocked; channel-B's
	// only message is already in flight too, so nothing new arrives.
	const r3 = await recv1();
	check('no further message while A1 (and B1) are still in flight', (r3.Messages ?? []).length === 0);

	// Delete A1 (turn 1 done) → channel-A unblocks → A2 becomes deliverable.
	const a1 = got.find((m) => m.Body === 'A turn 1')!;
	await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: a1.ReceiptHandle! }));
	log('   deleted A1 (turn 1 complete)');
	let a2seen = false;
	for (let i = 0; i < 5 && !a2seen; i++) {
		const r = await recv1();
		for (const m of r.Messages ?? []) {
			if (m.Body === 'A turn 2') a2seen = true;
			await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle! }));
		}
	}
	check('A turn 2 delivered only after turn 1 was deleted', a2seen);
}

async function leaseTest() {
	log('\n── Test 2: DynamoDB conditional-write lease = single owner ──');
	const channel = 'channel-A';
	const now = Date.now();
	const acquire = async (worker: string, leaseMs: number) => {
		try {
			await ddb.send(new PutItemCommand({
				TableName: TABLE_NAME,
				Item: {
					channelId: { S: channel },
					owner: { S: worker },
					expiresAt: { N: String(now + leaseMs) },
				},
				// Win only if no lease exists, OR the existing one has expired.
				ConditionExpression: 'attribute_not_exists(channelId) OR expiresAt < :now',
				ExpressionAttributeValues: { ':now': { N: String(now) } },
			}));
			return true;
		} catch (e: any) {
			if (e.name === 'ConditionalCheckFailedException') return false;
			throw e;
		}
	};
	// Two workers race for the same channel concurrently.
	const [w1, w2] = await Promise.all([acquire('worker-1', 30_000), acquire('worker-2', 30_000)]);
	log(`   race → worker-1 acquired=${w1}, worker-2 acquired=${w2}`);
	check('exactly one worker acquired the lease', (w1 ? 1 : 0) + (w2 ? 1 : 0) === 1);

	// A third worker while the lease is held → must fail.
	const w3 = await acquire('worker-3', 30_000);
	check('a new worker is rejected while the lease is held', w3 === false);

	// Simulate expiry: acquire with a lease that's already in the past, then a
	// fresh racer should reclaim it.
	await ddb.send(new PutItemCommand({
		TableName: TABLE_NAME,
		Item: { channelId: { S: channel }, owner: { S: 'stale' }, expiresAt: { N: String(now - 1) } },
	}));
	const reclaim = await acquire('worker-4', 30_000);
	check('an expired lease can be reclaimed', reclaim === true);
}

async function main() {
	let queueUrl: string | undefined;
	let tableCreated = false;
	try {
		log(`Region ${REGION} · queue ${QUEUE_NAME} · table ${TABLE_NAME}`);
		// --- create (private, AWS-API-only resources) ---
		const cq = await sqs.send(new CreateQueueCommand({
			QueueName: QUEUE_NAME,
			Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'false', VisibilityTimeout: '30' },
		}));
		queueUrl = cq.QueueUrl!;
		await sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }));
		log('   created FIFO queue');

		await ddb.send(new CreateTableCommand({
			TableName: TABLE_NAME,
			BillingMode: 'PAY_PER_REQUEST',
			AttributeDefinitions: [{ AttributeName: 'channelId', AttributeType: 'S' }],
			KeySchema: [{ AttributeName: 'channelId', KeyType: 'HASH' }],
		}));
		tableCreated = true;
		await waitUntilTableExists({ client: ddb, maxWaitTime: 60 }, { TableName: TABLE_NAME });
		log('   created DynamoDB table');

		await fifoTest(queueUrl);
		await leaseTest();

		log(`\n${pass ? '✅ PASS' : '❌ FAIL'}: single-writer mechanisms ${pass ? 'work as designed' : 'did NOT behave as expected'}.`);
		if (pass) log('   FIFO serializes turns per channel; DDB lease gives single-owner for the long loop.');
	} finally {
		// --- teardown (always) ---
		log('\n── teardown ──');
		if (queueUrl) {
			await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl })).then(
				() => log('   deleted queue'), (e) => log('   queue delete error:', e.name));
		}
		if (tableCreated) {
			await ddb.send(new DeleteTableCommand({ TableName: TABLE_NAME })).then(
				() => log('   deleted table (waiting for removal)'), (e) => log('   table delete error:', e.name));
			await waitUntilTableNotExists({ client: ddb, maxWaitTime: 60 }, { TableName: TABLE_NAME }).catch(() => {});
		}
	}
	process.exit(pass ? 0 : 1);
}

await main();
