/**
 * Strip Teams `<at>Name</at>` XML tags from activity text so the agent sees
 * the plain request without the bot mention markup.
 * Teams wraps @-mentions in <at>…</at> tags; they appear at the start of a
 * channel message (e.g. "<at>MyBot</at> explain this code").
 */
export function stripAtMention(text: string): string {
	return text.replace(/^(<at>[^<]*<\/at>\s*)+/, '').trim();
}
