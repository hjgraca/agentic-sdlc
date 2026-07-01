import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	decideAction,
	isAuthorized,
	mentionsAgent,
	splitRepo,
	type ThreadComment,
} from './helpers.ts';

// Run with: npm test  (node --test, no extra deps — see package.json).
// These cover the pure helpers the spec tools delegate to: repo-coord parsing,
// the cold-start ask/wait/converge reducer, mention detection (kickoff gate),
// and the write/admin authorization check.

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

const human = (body: string, author = 'maintainer'): ThreadComment => ({
	author,
	isAgent: false,
	body,
});
const agent = (body: string): ThreadComment => ({
	author: 'flue-spec[bot]',
	isAgent: true,
	body,
});

test('decideAction: engage on a fresh human comment (kickoff)', () => {
	assert.equal(decideAction([human('@flue-spec please spec this')]), 'engage');
});

test('decideAction: engage when a human replies after the agent asked', () => {
	const thread = [
		human('@flue-spec go'),
		agent('Q1: which trigger?'),
		human('webhook'),
	];
	assert.equal(decideAction(thread), 'engage');
});

test('decideAction: wait when the agent already responded last (nothing new)', () => {
	const thread = [
		human('@flue-spec go'),
		agent('Q1: which trigger?'),
	];
	assert.equal(decideAction(thread), 'wait');
});

test('decideAction: wait when there is no human comment at all', () => {
	assert.equal(decideAction([agent('checkpoint')]), 'wait');
	assert.equal(decideAction([]), 'wait');
});

test('decideAction: finalize when the latest human comment says so', () => {
	const thread = [
		human('@flue-spec go'),
		agent('checkpoint: anything else, or finalize?'),
		human('looks good, finalize'),
	];
	assert.equal(decideAction(thread), 'finalize');
});

test('decideAction: finalize is only from the LATEST human comment, not older ones', () => {
	// "finalize" appeared earlier but the newest human input is a new question →
	// keep engaging, do not prematurely write the spec.
	const thread = [
		human('finalize when ready'),
		agent('Q1?'),
		human('actually, change the deploy to k8s'),
	];
	assert.equal(decideAction(thread), 'engage');
});

test('mentionsAgent matches the handle on a boundary, case-insensitively', () => {
	assert.equal(mentionsAgent('hey @flue-spec can you help', 'flue-spec'), true);
	assert.equal(mentionsAgent('HEY @FLUE-SPEC', 'flue-spec'), true);
	assert.equal(mentionsAgent('cc @flue-spec, thanks', 'flue-spec'), true);
	// leading @ in the configured handle is tolerated
	assert.equal(mentionsAgent('@flue-spec go', '@flue-spec'), true);
});

test('mentionsAgent does not match a longer look-alike handle or plain text', () => {
	assert.equal(mentionsAgent('@flue-spec-bot go', 'flue-spec'), false);
	assert.equal(mentionsAgent('we should spec this', 'flue-spec'), false);
	assert.equal(mentionsAgent('no mention here', 'flue-spec'), false);
});

test('isAuthorized is true only for write and admin', () => {
	assert.equal(isAuthorized('admin'), true);
	assert.equal(isAuthorized('write'), true);
	assert.equal(isAuthorized('read'), false);
	assert.equal(isAuthorized('none'), false);
	assert.equal(isAuthorized('triage'), false); // GitHub's read-ish tier
});
