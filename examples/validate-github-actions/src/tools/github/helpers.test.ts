import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closingIssueNumber, preferredReviewEvent, splitRepo } from './helpers.ts';

// Run with: npm test  (node --test, no extra deps — see package.json).

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
		'noslash',
		'owner/',
		'/repo',
		'',
	]) {
		assert.throws(() => splitRepo(bad), /Invalid repo/, `expected "${bad}" rejected`);
	}
});

test('closingIssueNumber finds the linked spec issue', () => {
	assert.equal(closingIssueNumber('Builds the example.\n\nCloses #55'), 55);
	assert.equal(closingIssueNumber('fixes #7 in the body'), 7);
	assert.equal(closingIssueNumber('Resolves: #123'), 123);
	// Case-insensitive, mid-sentence.
	assert.equal(closingIssueNumber('This CLOSED #9 finally'), 9);
});

test('closingIssueNumber returns null when nothing is linked', () => {
	assert.equal(closingIssueNumber('No linked issue here.'), null);
	assert.equal(closingIssueNumber('See #55 for context'), null); // mention, not a closing keyword
	assert.equal(closingIssueNumber(''), null);
	assert.equal(closingIssueNumber(null), null);
	assert.equal(closingIssueNumber(undefined), null);
});

test('closingIssueNumber ignores cross-repo references', () => {
	// A foreign owner/repo#n must not be mistaken for the local spec issue.
	assert.equal(closingIssueNumber('Closes other/repo#88'), null);
	// A local one after a cross-repo one is still found.
	assert.equal(closingIssueNumber('Closes other/repo#88 and closes #12'), 12);
});

test('closingIssueNumber returns the first linked issue', () => {
	assert.equal(closingIssueNumber('Closes #3, closes #4'), 3);
});

test('preferredReviewEvent maps verdicts to review events', () => {
	assert.equal(preferredReviewEvent('matches'), 'APPROVE');
	assert.equal(preferredReviewEvent('changes-requested'), 'REQUEST_CHANGES');
	assert.equal(preferredReviewEvent('uncertain'), 'COMMENT');
});
