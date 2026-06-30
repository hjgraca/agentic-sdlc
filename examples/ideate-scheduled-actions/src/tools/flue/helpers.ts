/**
 * Pure helpers for the Flue docs tool. No network or env state, so they are
 * unit-testable in isolation (see helpers.test.ts). They live apart from
 * docs.ts because the agent builds its tool list with `Object.values(flueTools)`
 * — any non-tool export from that module would be swept in as a bogus tool.
 */

/**
 * The only host the doc fetcher will reach, and the path prefix it is pinned to.
 * Flue gives the agent no built-in web-fetch primitive; outbound HTTP is a typed
 * tool wrapping fetch(). We keep that tool from becoming a general web-scraper by
 * pinning it to the public Flue docs. The skill holds the specific list of doc
 * pages worth fetching; this is the hard boundary around them.
 */
export const DOC_ORIGIN = 'https://flueframework.com';
export const DOC_PATH_PREFIX = '/docs/';

/**
 * Decide whether `url` is an allowed Flue docs URL. Rejects anything that is not
 * exactly `https://flueframework.com/docs/...` — wrong scheme, wrong host
 * (including look-alikes like `flueframework.com.evil.test`, which `startsWith`
 * checks alone would miss), or a path outside `/docs/`. Returns a discriminated
 * result so the tool can hand the model an actionable reason instead of fetching
 * something it shouldn't.
 */
export function checkDocUrl(
	url: string,
): { ok: true; url: string } | { ok: false; reason: string } {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { ok: false, reason: `Not a valid URL: "${url}".` };
	}
	if (parsed.protocol !== 'https:') {
		return { ok: false, reason: `Only https is allowed, got "${parsed.protocol}".` };
	}
	if (parsed.origin !== DOC_ORIGIN) {
		return {
			ok: false,
			reason: `Only ${DOC_ORIGIN} is allowed, got "${parsed.origin}".`,
		};
	}
	if (!parsed.pathname.startsWith(DOC_PATH_PREFIX)) {
		return {
			ok: false,
			reason: `Only paths under ${DOC_PATH_PREFIX} are allowed, got "${parsed.pathname}".`,
		};
	}
	return { ok: true, url: parsed.toString() };
}
