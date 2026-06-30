import { defineAgent } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as githubTools from '../tools/github/github.ts';

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
// All of the agent's INPUTS are local filesystem reads — no fetch tool. The
// workflow shallow-clones Flue's public repo into ./context/flue before the run
// (the repo's gitignored `context/` convention for upstream reference), so the
// agent greps Flue's live blueprints, docs, and @flue/* package source on disk
// alongside this checkout's example matrix. Its only OUTBOUND tools are GitHub
// (list/create the agent-idea issues).
const cwd = process.env.SKILLS_DIR ?? process.cwd();

export default defineAgent(() => ({
	model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
	sandbox: local({ cwd }),
	tools: Object.values(githubTools),
}));
