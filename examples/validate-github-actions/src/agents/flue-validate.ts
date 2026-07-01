import { defineAgent } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as githubTools from '../tools/github/github.ts';

// The validation agent — the pipeline's review gate (ideate → spec → implement →
// **validate**). When the implement agent opens a PR, this agent reads the PR's
// diff and the linked spec issue and submits ONE review: APPROVE when the build
// matches the spec, REQUEST_CHANGES with an itemized list when it doesn't. The
// review is ADVISORY — a github-actions[bot] review does not satisfy required
// human approvals — so a human still merges. It just gives them a spec-match
// signal CI can't: CI answers "does it build/test", this answers "does it match
// what we agreed to build".
//
// SANDBOX: local() with NO forwarded env. Like the read-only spec agent (and
// unlike the implement agent), the model gets NO shell access to secrets: it
// judges intent-vs-spec through typed Octokit tools only, never checks out or
// runs the PR's code. The GitHub token stays in the HOST process where Octokit
// reads it — it is never exposed to the sandbox. This is the repo's default
// no-shell posture (ADR 0006 documents implement as the sole exception).
//
// There is no channel: one-shot in GitHub Actions. The workflow is the trigger
// (`on: pull_request` from the implement branch); the PR number arrives in
// --input and the agent reads everything else over the API.
const cwd = process.env.SKILLS_DIR ?? process.cwd();

export default defineAgent(() => ({
	model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
	sandbox: local({ cwd }),
	tools: Object.values(githubTools),
}));
