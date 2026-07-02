import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripAtMention } from './helpers.ts';

describe('stripAtMention', () => {
	it('strips a leading <at> tag and trailing space', () => {
		assert.equal(stripAtMention('<at>MyBot</at> explain this code'), 'explain this code');
	});

	it('strips multiple <at> tags (group-chat multi-mention)', () => {
		assert.equal(stripAtMention('<at>Bot</at> <at>Bot</at> ping'), 'ping');
	});

	it('leaves plain text untouched', () => {
		assert.equal(stripAtMention('hello world'), 'hello world');
	});

	it('returns empty string for mention-only text', () => {
		assert.equal(stripAtMention('<at>MyBot</at>'), '');
	});

	it('preserves <at>-like text in the middle of a message', () => {
		assert.equal(
			stripAtMention('explain <at>tags</at> in HTML'),
			'explain <at>tags</at> in HTML',
		);
	});
});
