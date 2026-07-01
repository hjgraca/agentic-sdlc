/**
 * Pure helper functions extracted from the linear tools so they can be unit-
 * tested without any SDK or network dependency.
 *
 * Run tests with:  npm test
 * (node --test, no extra deps — see package.json)
 */

/** Minimal shape of a Linear label as needed by these helpers. */
export interface LabelLike {
	id: string;
	name: string;
}

/** Minimal shape of a Linear issue as needed by these helpers. */
export interface IssueLike {
	title: string;
	description?: string | null;
	state?: { name: string } | null;
	priority?: number | null;
}

/** Minimal shape of a Linear user as needed by these helpers. */
export interface UserLike {
	name: string;
	displayName?: string;
}

/**
 * Return labels whose name appears (case-insensitive) in the concatenated
 * issue title + description. Used by the triage agent to pick the most
 * relevant labels from the team's label set before calling
 * `update_linear_issue`.
 */
export function pickBestLabel(
	labels: LabelLike[],
	issueTitle: string,
	description: string,
): LabelLike[] {
	const haystack = `${issueTitle} ${description}`.toLowerCase();
	return labels.filter((l) => haystack.includes(l.name.toLowerCase()));
}

/**
 * Format a structured triage summary suitable for posting as a Linear comment.
 * Pure function — accepts plain objects so it can be tested without the SDK.
 */
export function formatTriageSummary(issue: IssueLike, assignee?: UserLike): string {
	const state = issue.state?.name ?? 'Unknown';
	const lines: string[] = [
		`## Triage Summary`,
		``,
		`**Issue:** ${issue.title}`,
		`**Current state:** ${state}`,
		``,
		`**Root-cause hypothesis:** Review the issue description and related context for clues.`,
		`**Suggested next step:** Assign and label the issue, then investigate the root cause.`,
	];

	if (assignee) {
		lines.push(``, `**Suggested assignee:** ${assignee.displayName ?? assignee.name}`);
	}

	return lines.join('\n');
}
