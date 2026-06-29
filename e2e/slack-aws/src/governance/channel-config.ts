import { S3Client, GetObjectCommand, NoSuchKey } from '@aws-sdk/client-s3';
import * as v from 'valibot';

/**
 * Per-channel governance config (Claude Tag's "admins scope tools/data per
 * channel"). One JSON object per channel in the sessions bucket under config/.
 * Absent config → safe DEFAULT. The agent only ever exposes tools on the
 * allowlist and uses the configured model.
 *
 * Admins set this out-of-band (S3 put); read at turn start by the consumer.
 */
export const ALL_TOOLS = [
	'reply_in_slack',
	'schedule_followup',
	'post_to_channel',
	'post_in_thread',
	'register_thread',
] as const;
export type ToolName = (typeof ALL_TOOLS)[number];

const ConfigSchema = v.object({
	// Tools this channel's agent may use. Default: all.
	tools: v.optional(v.array(v.picklist(ALL_TOOLS))),
	// Optional model override (Flue model specifier).
	model: v.optional(v.string()),
	// Optional per-turn token ceiling (informational here; enforced by spend caps later).
	maxTokensPerTurn: v.optional(v.number()),
});
export type ChannelConfig = v.InferOutput<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Required<Pick<ChannelConfig, 'tools'>> & ChannelConfig = {
	tools: [...ALL_TOOLS],
};

let client: S3Client | undefined;
function s3(): S3Client {
	client ??= new S3Client(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {});
	return client;
}

function key(channelId: string): string {
	return `config/${encodeURIComponent(channelId)}.json`;
}

/**
 * Load a channel's config from S3, falling back to DEFAULT_CONFIG when none is
 * set or when SESSIONS_BUCKET is unset (local dev). Invalid stored config throws
 * — fail loud rather than silently granting the wrong scope.
 */
export async function loadChannelConfig(channelId: string): Promise<ChannelConfig> {
	const bucket = process.env.SESSIONS_BUCKET;
	if (!bucket) return DEFAULT_CONFIG;
	try {
		const res = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key(channelId) }));
		const raw = await res.Body!.transformToString();
		return v.parse(ConfigSchema, JSON.parse(raw));
	} catch (err) {
		if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey') {
			return DEFAULT_CONFIG;
		}
		throw err;
	}
}

/** The effective tool allowlist for a channel (config or default). */
export function allowedTools(config: ChannelConfig): ToolName[] {
	return config.tools ?? [...ALL_TOOLS];
}
