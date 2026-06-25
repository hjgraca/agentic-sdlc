import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { atlassianAuthHeader } from './auth.ts';

/**
 * Confluence tool used to read documentation pages that augment a triage —
 * e.g. coding standards and the testing guide. Outbound-only (the agent reads;
 * it never receives Confluence webhooks), so it is a tool, not a channel.
 *
 * Confluence Cloud shares Jira's Atlassian credentials (see ./atlassian.ts) and
 * lives under `/wiki` on the same JIRA_BASE_URL site.
 */
function confluence(path: string) {
	const base = process.env.JIRA_BASE_URL ?? '';
	return fetch(`${base}/wiki${path}`, {
		headers: { Authorization: atlassianAuthHeader(), Accept: 'application/json' },
	});
}

/** Reduce Confluence storage-format HTML to readable plain text for the model. */
function stripHtml(html: string): string {
	return html
		.replace(/<\/(p|h[1-6]|li|tr|div|br)>/gi, '\n')
		.replace(/<li[^>]*>/gi, '- ')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export const getPage = defineTool({
	name: 'confluence_get_page',
	description:
		'Fetch a Confluence page by its numeric id and return its title and plain-text body. Use to read documentation (e.g. coding standards, testing guide) that should inform the triage.',
	input: v.object({ pageId: v.string() }),
	run: async ({ input }) => {
		const res = await confluence(`/api/v2/pages/${input.pageId}?body-format=storage`);
		if (!res.ok) return `Confluence get page failed: ${res.status} ${await res.text()}`;
		const page = (await res.json()) as {
			title?: string;
			body?: { storage?: { value?: string } };
		};
		const text = stripHtml(page.body?.storage?.value ?? '');
		return JSON.stringify({ title: page.title, text });
	},
});
