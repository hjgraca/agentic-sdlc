/**
 * Minimal Fetch-based client for outbound Teams Bot Connector messaging.
 * Gets an OAuth 2.0 token via client-credentials (TEAMS_APP_ID / TEAMS_APP_PASSWORD),
 * then POSTs to <serviceUrl>v3/conversations/<conversationId>/activities.
 * No external SDK dependency beyond the `botframework-schema` type peer.
 */
import type { TeamsConversationRef } from '@flue/teams';

const TOKEN_URL = (tenantId: string) =>
	`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
const SCOPE = 'https://api.botframework.com/.default';

interface CachedToken {
	value: string;
	expiresAt: number;
}
let cachedToken: CachedToken | null = null;

async function getToken(): Promise<string> {
	const now = Date.now();
	if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

	const params = new URLSearchParams({
		grant_type: 'client_credentials',
		client_id: process.env.TEAMS_APP_ID!,
		client_secret: process.env.TEAMS_APP_PASSWORD!,
		scope: SCOPE,
	});
	const res = await fetch(TOKEN_URL(process.env.TEAMS_TENANT_ID!), {
		method: 'POST',
		body: params,
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
	});
	if (!res.ok) throw new Error(`Token fetch failed: ${res.status} ${await res.text()}`);
	const json = (await res.json()) as { access_token: string; expires_in: number };
	cachedToken = { value: json.access_token, expiresAt: now + json.expires_in * 1000 };
	return cachedToken.value;
}

export const teamsClient = {
	async postMessage(ref: TeamsConversationRef, text: string): Promise<void> {
		const token = await getToken();
		const url = `${ref.serviceUrl}v3/conversations/${encodeURIComponent(ref.conversationId)}/activities`;
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ type: 'message', text }),
		});
		if (!res.ok) throw new Error(`postMessage failed: ${res.status} ${await res.text()}`);
	},
};
