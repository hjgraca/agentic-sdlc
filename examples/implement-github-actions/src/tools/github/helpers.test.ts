import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideBuildMode, implementBranch, splitRepo } from './helpers.ts';

// Run with: npm test  (node --test, no extra deps — see package.json).
// These cover the pure helpers the implement tools + skill delegate to:
// repo-coord parsing, the stable branch name, and the idempotency build-mode
// decision (skip / update / create).

test('splitRepo accepts a well-formed owner/repo', () => {
	assert.deepEqual(splitRepo('octocat/hello-world'), {
		owner: 'octocat',
		repo: 'hello-world',
	});
});

test('splitRepo rejects malformed input with a clear error', () => {
	for (const bad of [
		'owner/repo/extra',
		'https://github.com/owner/repo',
		'justreponame',
		'owner/',
		'/repo',
		'',
	]) {
		assert.throws(() => splitRepo(bad), /Invalid repo/, `expected "${bad}" rejected`);
	}
});

test('implementBranch is stable and keyed on the issue number', () => {
	assert.equal(implementBranch(55), 'implement/issue-55');
	assert.equal(implementBranch(7), 'implement/issue-7');
	// Stability matters: the same issue must always map to the same branch so
	// re-runs converge on one PR (ADR 0006).
	assert.equal(implementBranch(55), implementBranch(55));
});

test('decideBuildMode: skip when the example already exists on main', () => {
	// Existing-on-main wins even if a PR is also open — a prior build merged.
	assert.equal(
		decideBuildMode({ exampleExistsOnMain: true, openPrExists: false }),
		'skip',
	);
	assert.equal(
		decideBuildMode({ exampleExistsOnMain: true, openPrExists: true }),
		'skip',
	);
});

test('decideBuildMode: update when an open PR exists (and example not on main)', () => {
	assert.equal(
		decideBuildMode({ exampleExistsOnMain: false, openPrExists: true }),
		'update',
	);
});

test('decideBuildMode: create when neither exists', () => {
	assert.equal(
		decideBuildMode({ exampleExistsOnMain: false, openPrExists: false }),
		'create',
	);
});
