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
 * `fetch_flue_doc` is pinned by checkDocUrl to two Flue surfaces —
 * https://flueframework.com/docs/* and the blueprint catalog at
 * https://flueframework.com/cli/blueprints/* (one implementation guide per
 * integration `flue add` supports) — so it cannot be turned into a general
 * web-scraper. The specific list of pages worth reading lives in the
 * flue-ideation skill, so it is editable without a rebuild.
 *
 * The other two inputs the agent uses — this repo's examples and installed Flue
 * (node_modules/@flue/*) — are local filesystem reads via the sandbox, not tools.
 */
export const fetchDoc = defineTool({
	name: 'fetch_flue_doc',
	description:
		'Fetch one Flue page as text, to learn what Flue offers (channels, tools, deploys, patterns, and the per-integration blueprint guides). URL must be under https://flueframework.com/docs/ or https://flueframework.com/cli/blueprints/. The skill lists which pages to read. Returns the page text, or an error string if the URL is not allowed or the fetch fails.',
	input: v.object({ url: v.string() }),
	run: async ({ input }) => {
		const check = checkDocUrl(input.url);
		if (!check.ok) {
			return `Refusing to fetch: ${check.reason}`;
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
