import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTriageSummary, pickBestLabel } from '../../../src/tools/linear/helpers.ts';

// Run with: npm test  (node --test, no extra deps — see package.json).
// These cover the pure helpers the triage tools delegate to: label selection
// and comment body formatting.

// ── pickBestLabel ────────────────────────────────────────────────────────────

test('pickBestLabel returns matching label when title contains keyword', () => {
	const labels = [
		{ id: 'l1', name: 'bug' },
		{ id: 'l2', name: 'feature' },
	];
	const result = pickBestLabel(labels, 'This is a bug report', '');
	assert.deepEqual(result, [{ id: 'l1', name: 'bug' }]);
});

test('pickBestLabel returns empty array when no label matches', () => {
	const labels = [{ id: 'l1', name: 'performance' }];
	const result = pickBestLabel(labels, 'Login page is broken', 'Cannot log in at all');
	assert.deepEqual(result, []);
});

test('pickBestLabel is case-insensitive', () => {
	const labels = [{ id: 'l1', name: 'Bug' }];
	const result = pickBestLabel(labels, 'BUG in payment flow', '');
	assert.deepEqual(result, [{ id: 'l1', name: 'Bug' }]);
});

test('pickBestLabel matches label name found in description (not just title)', () => {
	const labels = [{ id: 'l1', name: 'documentation' }];
	const result = pickBestLabel(labels, 'Update the README', 'The documentation is out of date');
	assert.deepEqual(result, [{ id: 'l1', name: 'documentation' }]);
});

test('pickBestLabel returns multiple matching labels', () => {
	const labels = [
		{ id: 'l1', name: 'bug' },
		{ id: 'l2', name: 'crash' },
		{ id: 'l3', name: 'feature' },
	];
	const result = pickBestLabel(labels, 'App crash is a bug', '');
	assert.deepEqual(result, [
		{ id: 'l1', name: 'bug' },
		{ id: 'l2', name: 'crash' },
	]);
});

// ── formatTriageSummary ──────────────────────────────────────────────────────

test('formatTriageSummary includes issue title, state name, and suggested next step', () => {
	const issue = { title: 'Payment fails on checkout', state: { name: 'In Progress' } };
	const summary = formatTriageSummary(issue);
	assert.ok(summary.includes('Payment fails on checkout'), 'should include title');
	assert.ok(summary.includes('In Progress'), 'should include state name');
	assert.ok(summary.includes('Suggested next step'), 'should include next step');
});

test('formatTriageSummary includes assignee name when provided', () => {
	const issue = { title: 'DB connection pool exhausted', state: { name: 'Open' } };
	const assignee = { name: 'alice', displayName: 'Alice Smith' };
	const summary = formatTriageSummary(issue, assignee);
	assert.ok(summary.includes('Alice Smith'), 'should include display name');
});

test('formatTriageSummary omits assignee section when not provided', () => {
	const issue = { title: 'Slow API response', state: { name: 'Open' } };
	const summary = formatTriageSummary(issue);
	assert.ok(!summary.includes('Suggested assignee'), 'should not include assignee section');
});

test('formatTriageSummary uses name when displayName is absent', () => {
	const issue = { title: 'Typo in error message', state: null };
	const assignee = { name: 'bob' };
	const summary = formatTriageSummary(issue, assignee);
	assert.ok(summary.includes('bob'), 'should fall back to name');
});

test('formatTriageSummary handles null state gracefully', () => {
	const issue = { title: 'Timeout on large files', state: null };
	const summary = formatTriageSummary(issue);
	assert.ok(summary.includes('Unknown'), 'should show Unknown when state is null');
});
