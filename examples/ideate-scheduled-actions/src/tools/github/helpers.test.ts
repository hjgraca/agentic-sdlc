import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	type DiscussionCategory,
	findCategoryId,
	type IdeaDiscussion,
	splitRepo,
	summariseIdeaMemory,
} from './helpers.ts';

// Run with: npm test  (node --test, no extra deps — see package.json).
// These cover the pure helpers the GitHub tools delegate to: repo-coord parsing,
// discussion-category resolution, and the idea-memory summary that drives dedup
// + the cheap-exit cap.

test('splitRepo accepts a well-formed owner/repo', () => {
	assert.deepEqual(splitRepo('octocat/hello-world'), {
		owner: 'octocat',
		repo: 'hello-world',
	});
});

test('splitRepo rejects malformed input with a clear error', () => {
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

const cats: DiscussionCategory[] = [
	{ id: 'DIC_1', name: 'Ideas' },
	{ id: 'DIC_2', name: 'General' },
	{ id: 'DIC_3', name: 'Q&A' },
];

test('findCategoryId resolves by name, case-insensitively', () => {
	assert.equal(findCategoryId(cats, 'Ideas'), 'DIC_1');
	assert.equal(findCategoryId(cats, 'ideas'), 'DIC_1');
	assert.equal(findCategoryId(cats, 'GENERAL'), 'DIC_2');
});

test('findCategoryId throws an actionable error when the category is missing', () => {
	assert.throws(
		() => findCategoryId(cats, 'Nope'),
		// message names the missing category AND lists what exists (setup hint)
		/not found[\s\S]*Ideas, General, Q&A/,
	);
});

test('findCategoryId lists "(none)" when the repo has no categories', () => {
	assert.throws(() => findCategoryId([], 'Ideas'), /\(none\)/);
});

const idea = (
	number: number,
	state: 'open' | 'closed',
): IdeaDiscussion => ({
	number,
	title: `idea ${number}`,
	state,
	url: `https://github.com/o/r/discussions/${number}`,
});

test('summariseIdeaMemory partitions open and closed ideas', () => {
	const mem = summariseIdeaMemory(
		[idea(1, 'open'), idea(2, 'closed'), idea(3, 'open')],
		5,
	);
	assert.equal(mem.openCount, 2);
	assert.equal(mem.closedCount, 1);
	assert.deepEqual(
		mem.open.map((i) => i.number),
		[1, 3],
	);
	assert.deepEqual(
		mem.closed.map((i) => i.number),
		[2],
	);
});

test('summariseIdeaMemory flags atCap only on OPEN ideas, not closed', () => {
	// 4 open + many closed must NOT be at a cap of 5 — closed ideas are
	// rejections, not live backlog, so they never push the agent over the cap.
	const discussions = [
		...Array.from({ length: 4 }, (_, i) => idea(i + 1, 'open')),
		...Array.from({ length: 20 }, (_, i) => idea(i + 100, 'closed')),
	];
	const mem = summariseIdeaMemory(discussions, 5);
	assert.equal(mem.openCount, 4);
	assert.equal(mem.atCap, false);
});

test('summariseIdeaMemory is at cap when open count reaches the cap', () => {
	const discussions = Array.from({ length: 5 }, (_, i) => idea(i + 1, 'open'));
	const mem = summariseIdeaMemory(discussions, 5);
	assert.equal(mem.atCap, true);
});

test('summariseIdeaMemory handles empty memory (a fresh repo)', () => {
	const mem = summariseIdeaMemory([], 5);
	assert.equal(mem.openCount, 0);
	assert.equal(mem.closedCount, 0);
	assert.equal(mem.atCap, false);
	assert.deepEqual(mem.open, []);
	assert.deepEqual(mem.closed, []);
});
