/**
 * Pure helpers for the Flue docs tool. No network or env state, so they are
 * unit-testable in isolation (see helpers.test.ts). They live apart from
 * docs.ts because the agent builds its tool list with `Object.values(flueTools)`
 * — any non-tool export from that module would be swept in as a bogus tool.
 */

/**
 * The only host the fetcher will reach, and the path prefixes it is pinned to.
 * Flue gives the agent no built-in web-fetch primitive; outbound HTTP is a typed
 * tool wrapping fetch(). We keep that tool from becoming a general web-scraper by
 * pinning it to two public Flue surfaces: the docs and the blueprint catalog
 * (the implementation guides `flue add` serves, one per integration). The skill
 * holds the specific list of pages worth fetching; this is the hard boundary.
 */
export const DOC_ORIGIN = 'https://flueframework.com';
export const ALLOWED_PATH_PREFIXES = ['/docs/', '/cli/blueprints/'] as const;

/**
 * Decide whether `url` is an allowed Flue URL. Rejects anything that is not
 * `https://flueframework.com/{docs,cli/blueprints}/...` — wrong scheme, wrong
 * host (including look-alikes like `flueframework.com.evil.test`, which
 * `startsWith` checks alone would miss), or a path outside the allowed
 * prefixes. Returns a discriminated result so the tool can hand the model an
 * actionable reason instead of fetching something it shouldn't.
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
	if (!ALLOWED_PATH_PREFIXES.some((p) => parsed.pathname.startsWith(p))) {
		return {
			ok: false,
			reason: `Only paths under ${ALLOWED_PATH_PREFIXES.join(' or ')} are allowed, got "${parsed.pathname}".`,
		};
	}
	return { ok: true, url: parsed.toString() };
}
