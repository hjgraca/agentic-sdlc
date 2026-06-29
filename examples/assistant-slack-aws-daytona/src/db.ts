import { sqlite } from '@flue/runtime/node';
import { s3Adapter } from './s3-adapter.ts';
import { dynamoAdapter } from './dynamo-adapter.ts';

// Durable per-channel memory. Preference order:
//  1. S3 (SESSIONS_BUCKET) — best for text-heavy channels: no size limit, flat
//     per-PUT cost, ~11x cheaper storage, no chunking. No VPC/NAT.
//  2. DynamoDB (SESSIONS_TABLE) — also no-VPC; kept as an alternative.
//  3. local SQLite file — dev fallback.
export default process.env.SESSIONS_BUCKET
	? s3Adapter({ bucket: process.env.SESSIONS_BUCKET, region: process.env.AWS_REGION })
	: process.env.SESSIONS_TABLE
		? dynamoAdapter({ tableName: process.env.SESSIONS_TABLE, region: process.env.AWS_REGION })
		: sqlite(process.env.FLUE_DB_PATH ?? './data/flue.db');
