import { defineAgent } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as githubTools from '../tools/github/github.ts';
import * as flueTools from '../tools/flue/docs.ts';

// Skills and AGENTS.md are discovered by Flue at init time from the sandbox cwd:
// `<cwd>/.agents/skills/<name>/SKILL.md` and `<cwd>/AGENTS.md`. No imports, no
// instructions field — the agent's framing lives in AGENTS.md, the procedure
// (load memory → cap check → survey → find gap → dedup → file one) lives in the
// flue-ideation skill.
//
// There is no channel: this example runs one-shot in GitHub Actions on an hourly
// `schedule:` cron. The workflow is the trigger, and `flue run flue-ideation`
// is the entry point. (Contrast triage-github-actions, which is label-triggered;
// this is the repo's first SCHEDULED example.)
//
// The agent reads two things from the local sandbox filesystem (no tool needed):
// the example matrix (this checkout) and installed Flue (node_modules/@flue/*).
// Its only outbound tools are GitHub (list/create issues) and a doc fetcher.
const cwd = process.env.SKILLS_DIR ?? process.cwd();

export default defineAgent(() => ({
	model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
	sandbox: local({ cwd }),
	tools: [...Object.values(githubTools), ...Object.values(flueTools)],
}));
