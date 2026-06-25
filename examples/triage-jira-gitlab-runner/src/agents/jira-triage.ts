import { defineAgent } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as confluenceTools from '../tools/atlassian/confluence.ts';
import * as jiraTools from '../tools/atlassian/jira.ts';
import * as gitlabTools from '../tools/gitlab/gitlab.ts';

// Skills and AGENTS.md are discovered by Flue at init time from the sandbox cwd:
// `<cwd>/.agents/skills/<name>/SKILL.md` and `<cwd>/AGENTS.md`. No imports, no
// instructions field — the agent's framing lives in AGENTS.md, the procedure
// and the GitLab repo list live in the jira-triage skill.
//
// There is no channel: this example runs one-shot in GitLab CI. The pipeline is
// the trigger (Jira automation → GitLab pipeline trigger API), the issue key
// arrives as a CI variable, and `flue run jira-triage --input '{"issueKey":…}'`
// is the entry point. (Contrast triage-jira-k8s, which uses a webhook channel.)
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
