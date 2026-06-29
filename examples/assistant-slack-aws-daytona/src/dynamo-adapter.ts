/**
 * DynamoDB-backed Flue PersistenceAdapter — minimal & faithful for the one-shot
 * consumer model (each SQS turn = a fresh `flue run` process that does one turn
 * and exits). Across processes, only the SESSION (conversation memory) must
 * survive; submissions/runs/event-streams are created and settled within one
 * process, so they stay in in-memory SQLite.
 *
 * Design: wrap sqlite(':memory:') for executionStore.submissions + runStore +
 * eventStreamStore, and swap ONLY executionStore.sessions for a DynamoDB store.
 * SessionStore is 3 methods: save / load / delete, keyed by the agent instance
 * id (here: the Slack channel key).
 */
import {
	DynamoDBClient, PutItemCommand, QueryCommand, BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { sqlite } from '@flue/runtime/node';
import type { PersistenceAdapter } from '@flue/runtime/adapter';
import type { SessionData } from '@flue/runtime/adapter';

interface SessionStore {
	save(id: string, data: SessionData): Promise<void>;
	load(id: string): Promise<SessionData | null>;
	delete(id: string): Promise<void>;
}

// DynamoDB caps an item at 400KB. A long-running channel conversation can exceed
// that, so we CHUNK the session JSON across items keyed (sessionId HASH, chunk
// RANGE): chunk 0 carries a `count` of how many chunks exist. Read reassembles
// in order; save overwrites lower indices and prunes any leftover higher ones;
// delete removes them all. Stay well under 400KB per item.
const CHUNK_BYTES = 300 * 1024;

function chunkString(s: string, size: number): string[] {
	if (s.length === 0) return [''];
	const out: string[] = [];
	for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
	return out;
}

function dynamoSessionStore(client: DynamoDBClient, tableName: string): SessionStore {
	async function chunkKeys(id: string): Promise<number[]> {
		const keys: number[] = [];
		let startKey: Record<string, import("@aws-sdk/client-dynamodb").AttributeValue> | undefined;
		do {
			const res = await client.send(new QueryCommand({
				TableName: tableName,
				KeyConditionExpression: 'sessionId = :s',
				ExpressionAttributeValues: { ':s': { S: id } },
				ProjectionExpression: 'chunk',
				ConsistentRead: true,
				...(startKey ? { ExclusiveStartKey: startKey } : {}),
			}));
			for (const it of res.Items ?? []) keys.push(Number(it.chunk!.N));
			startKey = res.LastEvaluatedKey;
		} while (startKey);
		return keys;
	}
	async function deleteChunks(id: string, chunks: number[]): Promise<void> {
		for (let i = 0; i < chunks.length; i += 25) {
			const batch = chunks.slice(i, i + 25);
			await client.send(new BatchWriteItemCommand({
				RequestItems: {
					[tableName]: batch.map((c) => ({
						DeleteRequest: { Key: { sessionId: { S: id }, chunk: { N: String(c) } } },
					})),
				},
			}));
		}
	}
	return {
		async save(id, data) {
			const parts = chunkString(JSON.stringify(data), CHUNK_BYTES);
			for (let i = 0; i < parts.length; i++) {
				await client.send(new PutItemCommand({
					TableName: tableName,
					Item: {
						sessionId: { S: id }, chunk: { N: String(i) }, body: { S: parts[i] },
						...(i === 0 ? { count: { N: String(parts.length) } } : {}),
					},
				}));
			}
			// Prune stale higher-index chunks left by a previously larger session.
			const stale = (await chunkKeys(id)).filter((c) => c >= parts.length);
			await deleteChunks(id, stale);
		},
		async load(id) {
			// DynamoDB Query returns at most 1MB per page, so paginate via
			// LastEvaluatedKey — a multi-chunk session easily exceeds one page.
			const items: Record<string, { N?: string; S?: string }>[] = [];
			let startKey: Record<string, import("@aws-sdk/client-dynamodb").AttributeValue> | undefined;
			do {
				const res = await client.send(new QueryCommand({
					TableName: tableName,
					KeyConditionExpression: 'sessionId = :s',
					ExpressionAttributeValues: { ':s': { S: id } },
					ConsistentRead: true, // a turn must see the prior turn's write
					...(startKey ? { ExclusiveStartKey: startKey } : {}),
				}));
				for (const it of res.Items ?? []) items.push(it as never);
				startKey = res.LastEvaluatedKey;
			} while (startKey);
			if (items.length === 0) return null;
			items.sort((a, b) => Number(a.chunk!.N) - Number(b.chunk!.N));
			return JSON.parse(items.map((it) => it.body?.S ?? '').join('')) as SessionData;
		},
		async delete(id) {
			await deleteChunks(id, await chunkKeys(id));
		},
	};
}

/**
 * A PersistenceAdapter whose sessions live in DynamoDB and whose
 * submissions/runs/events live in in-memory SQLite (sufficient for the one-shot
 * consumer). `endpoint` lets tests point at DynamoDB Local.
 */
export function dynamoAdapter(opts: {
	tableName: string;
	region?: string;
	endpoint?: string;
}): PersistenceAdapter {
	const client = new DynamoDBClient({
		...(opts.region ? { region: opts.region } : {}),
		// When pointed at DynamoDB Local, use fixed dummy creds — Local partitions
		// data by (accessKeyId, region), so the client and table-creator must agree.
		// In real AWS, omit creds so the Lambda execution-role chain is used.
		...(opts.endpoint
			? { endpoint: opts.endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
			: {}),
	});
	const mem = sqlite(); // in-memory SQLite for the machinery we don't persist
	return {
		migrate() {
			return mem.migrate?.();
		},
		async connect() {
			const stores = await mem.connect();
			const sessions = dynamoSessionStore(client, opts.tableName);
			return {
				...stores,
				executionStore: { ...stores.executionStore, sessions },
			};
		},
		async close() {
			await mem.close?.();
			client.destroy();
		},
	};
}
