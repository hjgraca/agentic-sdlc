import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchEnvelope, splitRepo } from './helpers.ts';

// Run with: npm test  (node --test, no extra deps — see package.json).
// These cover the two pure helpers the GitHub tools delegate to: repo-coord
// parsing (issue #5) and the search-result truncation envelope (issue #8).

test('splitRepo accepts a well-formed owner/repo', () => {
	assert.deepEqual(splitRepo('octocat/hello-world'), {
		owner: 'octocat',
		repo: 'hello-world',
	});
});

test('splitRepo rejects malformed input with a clear error', () => {
	// Each of these silently produced a wrong/undefined coordinate before #5.
	for (const bad of [
		'owner/repo/extra', // extra path segment
		'https://github.com/owner/repo', // pasted URL
		'justreponame', // no slash
		'owner/', // empty repo
		'/repo', // empty owner
		'', // empty string
	]) {
		assert.throws(
			() => splitRepo(bad),
			/Invalid repo/,
			`expected "${bad}" to be rejected`,
		);
	}
});

test('searchEnvelope flags truncation when more matches exist than returned', () => {
	const items = Array.from({ length: 20 }, (_, i) => ({ path: `f${i}.ts` }));
	const env = searchEnvelope(137, items);
	assert.equal(env.total_count, 137);
	assert.equal(env.returned, 20);
	assert.equal(env.truncated, true);
	assert.equal(env.items, items);
});

test('searchEnvelope reports full coverage when all matches are returned', () => {
	const items = [{ number: 1 }, { number: 2 }];
	const env = searchEnvelope(2, items);
	assert.equal(env.total_count, 2);
	assert.equal(env.returned, 2);
	assert.equal(env.truncated, false);
});

test('searchEnvelope handles the empty result set', () => {
	const env = searchEnvelope(0, []);
	assert.equal(env.total_count, 0);
	assert.equal(env.returned, 0);
	assert.equal(env.truncated, false);
	assert.deepEqual(env.items, []);
});
