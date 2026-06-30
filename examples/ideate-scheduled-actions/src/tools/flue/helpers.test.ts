import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDocUrl } from './helpers.ts';

// Run with: npm test  (node --test, no extra deps — see package.json).
// These cover the URL allowlist that keeps the fetch tool pinned to the two Flue
// surfaces (docs + the blueprint catalog) and stops it from becoming a general
// web-scraper (SSRF surface).

test('checkDocUrl accepts a real Flue docs URL', () => {
	const r = checkDocUrl('https://flueframework.com/docs/ecosystem/channels/');
	assert.equal(r.ok, true);
	assert.equal(
		r.ok && r.url,
		'https://flueframework.com/docs/ecosystem/channels/',
	);
});

test('checkDocUrl accepts a blueprint catalog URL', () => {
	for (const good of [
		'https://flueframework.com/cli/blueprints/slack.md', // named blueprint
		'https://flueframework.com/cli/blueprints/sandbox.md', // generic kind guide
	]) {
		const r = checkDocUrl(good);
		assert.equal(r.ok, true, `expected "${good}" accepted`);
	}
});

test('checkDocUrl rejects non-https schemes', () => {
	for (const bad of [
		'http://flueframework.com/docs/quickstart/',
		'file:///etc/passwd',
		'ftp://flueframework.com/docs/x',
	]) {
		const r = checkDocUrl(bad);
		assert.equal(r.ok, false, `expected "${bad}" rejected`);
	}
});

test('checkDocUrl rejects other hosts and look-alike hosts', () => {
	for (const bad of [
		'https://evil.test/docs/x', // unrelated host
		'https://flueframework.com.evil.test/docs/x', // suffix look-alike
		'https://api.github.com/repos/o/r/issues', // a real API the agent must not hit
	]) {
		const r = checkDocUrl(bad);
		assert.equal(r.ok, false, `expected "${bad}" rejected`);
	}
});

test('checkDocUrl rejects paths outside the allowed prefixes on the right host', () => {
	for (const bad of [
		'https://flueframework.com/', // root
		'https://flueframework.com/blog/post', // wrong section
		'https://flueframework.com/docs', // missing trailing slash → not under /docs/
		'https://flueframework.com/cli/', // /cli/ but not the blueprints subtree
		'https://flueframework.com/cli/run', // a different /cli/ route
	]) {
		const r = checkDocUrl(bad);
		assert.equal(r.ok, false, `expected "${bad}" rejected`);
	}
});

test('checkDocUrl rejects unparseable input', () => {
	const r = checkDocUrl('not a url');
	assert.equal(r.ok, false);
});
