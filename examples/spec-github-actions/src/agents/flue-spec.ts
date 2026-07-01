import { defineAgent } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as githubTools from '../tools/github/github.ts';

// Skills and AGENTS.md are discovered by Flue at init time from the sandbox cwd:
// `<cwd>/.agents/skills/<name>/SKILL.md` and `<cwd>/AGENTS.md`. No imports, no
// instructions field — the agent's framing lives in AGENTS.md, the interview
// procedure + design tree + spec template live in the flue-spec skill.
//
// There is no channel: this example runs one-shot in GitHub Actions. The
// workflow (spec.yml) is the trigger — a comment on a Discussion — and
// `flue run flue-spec --input '{"message":…}'` is the entry point, where the
// message carries the discussion ref + the commenter. The agent runs an ASYNC
// spec interview: each wake is cold, so it re-reads the whole discussion thread
// (its only memory) and asks the next batch of decisions, posts a convergence
// checkpoint, or writes the final build-ready spec. See ADR 0004.
//
// It reads Flue's live source for grounding: the workflow shallow-clones Flue
// into ./context/flue (blueprints + packages/ + apps/docs), which the agent
// greps on disk — same clone the ideation example uses.
const cwd = process.env.SKILLS_DIR ?? process.cwd();

export default defineAgent(() => ({
	model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
	sandbox: local({ cwd }),
	tools: Object.values(githubTools),
}));
