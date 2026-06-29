import { defineAgent } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as githubTools from '../tools/github/github.ts';

// Skills and AGENTS.md are discovered by Flue at init time from the sandbox cwd:
// `<cwd>/.agents/skills/<name>/SKILL.md` and `<cwd>/AGENTS.md`. No imports, no
// instructions field — the agent's framing lives in AGENTS.md, the procedure
// and the repo list live in the github-triage skill.
//
// There is no channel: this example runs one-shot in GitHub Actions. The
// workflow is the trigger (`on: issues [labeled]`, gated to a `triage` label),
// the issue ref arrives as an input, and `flue run github-triage --input
// '{"message":…}'` is the entry point. (Contrast triage-jira-k8s, which uses a
// long-running webhook channel — and @flue/github's createGitHubChannel, the
// webhook path we deliberately did NOT use here. See README "Why no channel".)
const cwd = process.env.SKILLS_DIR ?? process.cwd();

export default defineAgent(() => ({
	model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
	sandbox: local({ cwd }),
	tools: Object.values(githubTools),
}));
