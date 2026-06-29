/**
 * SQS consumer Lambda (container image). For each Slack app_mention turn enqueued
 * by the verify-Lambda, runs the real Flue agent to completion keyed by the Slack
 * conversation (the path proven in spikes/e2e-consumer), then the agent posts its
 * own reply via the reply_in_slack tool.
 *
 * Why shell out to `flue run` instead of an in-process call: it's the supported
 * public run-to-completion API (boots an ephemeral runtime, runs the agent
 * through the normal app with --id, prints the terminal result, exits), verified
 * end to end in spike #6. The container ships the Flue CLI.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const execFileAsync = promisify(execFile);

interface SqsEvent { Records: { body: string }[] }
interface Turn { channelId: string; teamId: string; threadTs: string; messageTs: string; text: string; eventId: string }

// Slack bot token is read once per warm container from Secrets Manager and
// injected into the agent process env (the reply_in_slack tool reads it).
let cachedToken: string | undefined;
async function slackToken(): Promise<string> {
	if (cachedToken) return cachedToken;
	const sm = new SecretsManagerClient({});
	const res = await sm.send(new GetSecretValueCommand({ SecretId: process.env.SLACK_SECRET_ID! }));
	const parsed = JSON.parse(res.SecretString ?? '{}') as { SLACK_BOT_TOKEN?: string };
	if (!parsed.SLACK_BOT_TOKEN) throw new Error('SLACK_BOT_TOKEN missing from secret');
	cachedToken = parsed.SLACK_BOT_TOKEN;
	return cachedToken;
}

// Memory key = CHANNEL (one shared Claude per channel; anyone picks up the
// conversation). NOT per-thread — that would silo each mention's memory.
function conversationKey(t: Turn): string {
	return `slack:${t.teamId}:${t.channelId}`;
}

/**
 * Add an 👀 reaction to the user's message the instant this worker picks it up
 * — a visible "a worker has started on this" signal, posted BEFORE the slow
 * agent run. Best-effort: a reaction failure must never block the actual work.
 * Needs the bot scope `reactions:write`.
 */
async function ackPickup(t: Turn, token: string): Promise<void> {
	try {
		const res = await fetch('https://slack.com/api/reactions.add', {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ channel: t.channelId, timestamp: t.messageTs, name: 'eyes' }),
		});
		const body = (await res.json()) as { ok: boolean; error?: string };
		// `already_reacted` on a redelivery is fine; log anything else.
		if (!body.ok && body.error !== 'already_reacted') {
			console.warn(`[turn ${t.eventId}] reactions.add not ok: ${body.error}`);
		}
	} catch (err) {
		console.warn(`[turn ${t.eventId}] reactions.add threw (non-fatal):`, err);
	}
}

async function runTurn(t: Turn, token: string): Promise<void> {
	const id = conversationKey(t);
	const input = JSON.stringify({ message: t.text });
	// /tmp is Lambda's only writable path; FLUE_DB_PATH points src/db.ts there.
	const { stdout } = await execFileAsync(
		'node', ['/var/task/node_modules/@flue/cli/dist/flue.js', 'run', 'assistant',
			'--id', id, '--input', input, '--target', 'node'],
		{
			cwd: '/var/task',
			env: {
				...process.env,
				SLACK_BOT_TOKEN: token,
				FLUE_DB_PATH: '/tmp/flue.db',
				// Per-turn reply destination (the agent is keyed by channel, so the
				// thread to reply into is passed per invocation, not via the id).
				SLACK_CHANNEL_ID: t.channelId,
				SLACK_TEAM_ID: t.teamId,
				SLACK_THREAD_TS: t.threadTs,
				// schedule_followup tool: where a future wake is enqueued + the role
				// EventBridge assumes to do it. (SCHEDULE_* set on the Lambda config.)
				...(process.env.SCHEDULE_QUEUE_ARN ? { SCHEDULE_QUEUE_ARN: process.env.SCHEDULE_QUEUE_ARN } : {}),
				...(process.env.SCHEDULE_ROLE_ARN ? { SCHEDULE_ROLE_ARN: process.env.SCHEDULE_ROLE_ARN } : {}),
			},
			maxBuffer: 16 * 1024 * 1024,
			timeout: 13 * 60 * 1000,
		},
	);
	console.log(`[turn ${t.eventId}] agent run complete for ${id}: ${stdout.slice(0, 200)}`);
}

export async function handler(event: SqsEvent): Promise<void> {
	const token = await slackToken();
	for (const rec of event.Records) {
		let turn: Turn;
		try { turn = JSON.parse(rec.body) as Turn; }
		catch { console.error('skip: unparseable SQS body'); continue; }
		console.log(`[turn ${turn.eventId}] channel=${turn.channelId} text=${turn.text.slice(0, 80)}`);
		await ackPickup(turn, token);  // 👀 the moment we pick it up, before the agent runs
		await runTurn(turn, token);
	}
}
