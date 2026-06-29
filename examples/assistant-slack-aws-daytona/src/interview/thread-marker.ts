import { S3Client, GetObjectCommand, PutObjectCommand, NoSuchKey } from '@aws-sdk/client-s3';

/**
 * Thread routing for the interview flow. When the agent opens a conversation it
 * registers the thread root ts; a later plain reply in that thread is routed
 * back to the conversation by looking the marker up. No marker → not ours →
 * dropped by the verify-Lambda (so the bot ignores unrelated channel chatter
 * cheaply, before any model cost).
 *
 * Marker object: threads/<channelId>/<threadTs>.json → { conversationId }.
 * Reuses the sessions bucket; no new infra.
 */
export interface ThreadMarker {
	conversationId: string;
}

let client: S3Client | undefined;
function s3(): S3Client {
	client ??= new S3Client(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {});
	return client;
}

function key(channelId: string, threadTs: string): string {
	return `threads/${encodeURIComponent(channelId)}/${encodeURIComponent(threadTs)}.json`;
}

/** Record that `threadTs` in `channelId` belongs to `conversationId`. */
export async function registerThread(
	channelId: string,
	threadTs: string,
	conversationId: string,
): Promise<void> {
	const bucket = process.env.SESSIONS_BUCKET;
	if (!bucket) return; // local dev without S3: routing not available
	await s3().send(new PutObjectCommand({
		Bucket: bucket,
		Key: key(channelId, threadTs),
		Body: JSON.stringify({ conversationId } satisfies ThreadMarker),
		ContentType: 'application/json',
	}));
}

/** Look up the conversation a thread reply belongs to, or null if untracked. */
export async function lookupThread(
	channelId: string,
	threadTs: string,
): Promise<ThreadMarker | null> {
	const bucket = process.env.SESSIONS_BUCKET;
	if (!bucket) return null;
	try {
		const res = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key(channelId, threadTs) }));
		return JSON.parse(await res.Body!.transformToString()) as ThreadMarker;
	} catch (err) {
		if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey') return null;
		throw err;
	}
}
