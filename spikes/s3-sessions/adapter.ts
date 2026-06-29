/**
 * S3-backed Flue PersistenceAdapter — best fit for text-heavy channels: one S3
 * object per session, NO size limit (5TB), flat per-PUT write cost, ~11x cheaper
 * storage than DynamoDB, and no chunking/pagination machinery.
 *
 * Same shape as the DynamoDB adapter: wrap in-memory sqlite() for
 * submissions/runs/events, swap ONLY executionStore.sessions for S3. Correct
 * because (a) each SQS turn is a one-shot `flue run` so only the session crosses
 * processes, and (b) SQS FIFO serializes turns per channel, so we never need S3
 * conditional writes. S3 has been strongly read-after-write consistent since
 * 2020, so a turn always sees the prior turn's write.
 */
import {
	S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, NoSuchKey,
} from '@aws-sdk/client-s3';
import { sqlite } from '@flue/runtime/node';
import type { PersistenceAdapter, SessionData } from '@flue/runtime/adapter';

interface SessionStore {
	save(id: string, data: SessionData): Promise<void>;
	load(id: string): Promise<SessionData | null>;
	delete(id: string): Promise<void>;
}

// Encode the session id into a safe, flat key. encodeURIComponent keeps it a
// single path segment (no slashes from ids like `slack:T:C`).
function keyFor(prefix: string, id: string): string {
	return `${prefix}${encodeURIComponent(id)}.json`;
}

function s3SessionStore(client: S3Client, bucket: string, prefix: string): SessionStore {
	return {
		async save(id, data) {
			await client.send(new PutObjectCommand({
				Bucket: bucket, Key: keyFor(prefix, id),
				Body: JSON.stringify(data), ContentType: 'application/json',
			}));
		},
		async load(id) {
			try {
				const res = await client.send(new GetObjectCommand({
					Bucket: bucket, Key: keyFor(prefix, id),
				}));
				const body = await res.Body!.transformToString();
				return JSON.parse(body) as SessionData;
			} catch (err) {
				if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey') return null;
				throw err;
			}
		},
		async delete(id) {
			await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: keyFor(prefix, id) }));
		},
	};
}

export function s3Adapter(opts: {
	bucket: string;
	prefix?: string;
	region?: string;
	endpoint?: string; // for a local S3 (minio) in tests
}): PersistenceAdapter {
	const client = new S3Client({
		...(opts.region ? { region: opts.region } : {}),
		...(opts.endpoint
			? {
					endpoint: opts.endpoint,
					forcePathStyle: true, // minio / local S3
					credentials: { accessKeyId: 'local', secretAccessKey: 'localsecret' },
				}
			: {}),
	});
	const prefix = opts.prefix ?? 'sessions/';
	const mem = sqlite();
	return {
		migrate() {
			return mem.migrate?.();
		},
		async connect() {
			const stores = await mem.connect();
			return {
				...stores,
				executionStore: { ...stores.executionStore, sessions: s3SessionStore(client, opts.bucket, prefix) },
			};
		},
		async close() {
			await mem.close?.();
			client.destroy();
		},
	};
}
