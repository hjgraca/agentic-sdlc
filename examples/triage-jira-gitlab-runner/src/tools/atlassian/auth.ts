/**
 * Shared Atlassian Cloud auth. Jira and Confluence live on the same site and
 * use the same basic-auth credentials:
 *   JIRA_EMAIL      the account email
 *   JIRA_API_TOKEN  an Atlassian API token
 */
export function atlassianAuthHeader(): string {
	const basic = Buffer.from(
		`${process.env.JIRA_EMAIL ?? ''}:${process.env.JIRA_API_TOKEN ?? ''}`,
	).toString('base64');
	return `Basic ${basic}`;
}
