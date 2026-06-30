import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { checkDocUrl } from './helpers.ts';

/**
 * Flue documentation tool. The ideation agent compares Flue's CAPABILITIES
 * against this repo's example matrix; the docs carry intent and recommended
 * patterns that raw package source in node_modules does not. But Flue gives the
 * agent no built-in web-fetch primitive — outbound HTTP, like every other
 * outbound call in this repo, is a typed defineTool wrapping fetch() in the host
 * Node process. The model never gets an arbitrary fetcher.
 *
 * `fetch_flue_doc` is pinned to https://flueframework.com/docs/* by checkDocUrl
 * so it cannot be turned into a general web-scraper. The specific list of pages
 * worth reading (quickstart, ecosystem/channels, ecosystem/deploy, …) lives in
 * the flue-ideation skill, so it is editable without a rebuild.
 *
 * The other two inputs the agent uses — this repo's examples and installed Flue
 * (node_modules/@flue/*) — are local filesystem reads via the sandbox, not tools.
 */
export const fetchDoc = defineTool({
	name: 'fetch_flue_doc',
	description:
		'Fetch one Flue documentation page as text, to learn what Flue offers (channels, tools, deploys, patterns). URL must be under https://flueframework.com/docs/. The skill lists which pages to read. Returns the page text, or an error string if the URL is not an allowed docs URL or the fetch fails.',
	input: v.object({ url: v.string() }),
	run: async ({ input }) => {
		const check = checkDocUrl(input.url);
		if (!check.ok) {
			return `Refusing to fetch: ${check.reason} Only Flue docs pages (https://flueframework.com/docs/...) are allowed.`;
		}
		try {
			const res = await fetch(check.url, {
				headers: { accept: 'text/html,text/markdown,text/plain' },
			});
			if (!res.ok) {
				return `Flue doc fetch failed: HTTP ${res.status} ${res.statusText} for ${check.url}`;
			}
			return await res.text();
		} catch (err) {
			return `Flue doc fetch failed: ${String(err)}`;
		}
	},
});
