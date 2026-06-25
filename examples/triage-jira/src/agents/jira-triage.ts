import { defineAgent } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as confluenceTools from '../tools/atlassian/confluence.ts';
import * as jiraTools from '../tools/atlassian/jira.ts';
import * as gitlabTools from '../tools/gitlab/gitlab.ts';

// Skills and AGENTS.md are discovered by Flue at init time from the sandbox cwd:
// `<cwd>/.agents/skills/<name>/SKILL.md` and `<cwd>/AGENTS.md`. No imports, no
// instructions field — the agent's framing lives in AGENTS.md, the procedure
// and the GitLab repo list live in the jira-triage skill. In production, mount
// the Skills Project and point SKILLS_DIR at it.
//
// Ingress and its auth live in the Jira channel (src/channels/jira.ts), which
// verifies the webhook secret and dispatches here by issue key. This agent is
// not exposed as a direct HTTP route, so it needs no route handler of its own.
const cwd = process.env.SKILLS_DIR ?? process.cwd();

export default defineAgent(() => ({
	model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
	sandbox: local({ cwd }),
	tools: [
		...Object.values(jiraTools),
		...Object.values(confluenceTools),
		...Object.values(gitlabTools),
	],
}));
