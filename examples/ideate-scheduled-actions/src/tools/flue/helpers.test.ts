import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDocUrl } from './helpers.ts';

// Run with: npm test  (node --test, no extra deps — see package.json).
// These cover the doc-URL allowlist that keeps the fetch tool pinned to the Flue
// docs and stops it from becoming a general web-scraper (SSRF surface).

test('checkDocUrl accepts a real Flue docs URL', () => {
	const r = checkDocUrl('https://flueframework.com/docs/ecosystem/channels/');
	assert.equal(r.ok, true);
	assert.equal(
		r.ok && r.url,
		'https://flueframework.com/docs/ecosystem/channels/',
	);
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

test('checkDocUrl rejects paths outside /docs/ on the right host', () => {
	for (const bad of [
		'https://flueframework.com/', // root
		'https://flueframework.com/blog/post', // wrong section
		'https://flueframework.com/docs', // missing trailing slash → not under /docs/
	]) {
		const r = checkDocUrl(bad);
		assert.equal(r.ok, false, `expected "${bad}" rejected`);
	}
});

test('checkDocUrl rejects unparseable input', () => {
	const r = checkDocUrl('not a url');
	assert.equal(r.ok, false);
});
