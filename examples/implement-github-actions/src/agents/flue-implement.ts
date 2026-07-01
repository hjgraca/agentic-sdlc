import { defineAgent } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as githubTools from '../tools/github/github.ts';

// The implementation agent turns an APPROVED spec into a working example and
// opens a PR. Unlike every other agent in this repo, it is a CODING agent: it
// needs the edit→build→test→fix loop, so it runs in a real sandbox with a shell.
//
// SANDBOX: local() on the GitHub Actions runner (ADR 0006). local() gives the
// model built-in file + command capabilities against the checked-out repo — no
// file/shell tools to define. We use local(), NOT Daytona (the repo default),
// for a documented reason: the runner is ALREADY an ephemeral, isolated box with
// the repo checkout, git, and GITHUB_TOKEN, and the work product is a git branch
// + PR that must originate here. A separate Daytona box would be a redundant
// sandbox plus a build-artifact-shuttle handoff for no benefit.
//
// TOKEN FORWARDING: unlike the read-only agents (which keep the token in the host
// process and never give the model a shell), this agent's shell runs `git` and
// `gh`, so it needs the GitHub token INSIDE the sandbox. We forward ONLY that
// (env is limited by default). Safety model (ADR 0006): the `implement` label is
// maintainer-gated (privileged trigger), deps install with --ignore-scripts +
// pinned versions, the token is scoped to this repo's contents/pull-requests, and
// the PR is the human review gate. It builds + tests only — it NEVER deploys.
//
// There is no channel: one-shot in GitHub Actions. The workflow is the trigger
// (`on: issues [labeled]`, gated to `implement`); the issue number arrives in
// --input and the agent reads the spec from the issue body via github_get_issue.
const cwd = process.env.SKILLS_DIR ?? process.cwd();

export default defineAgent(() => ({
	model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
	sandbox: local({
		cwd,
		// Forward only what the shell needs — env is limited by default:
		//  - the GitHub token (gh reads GH_TOKEN; some tooling reads GITHUB_TOKEN),
		//    so the shell can branch/commit/push and open the PR;
		//  - TARGET_REPO_DIR: the repo the agent BUILDS INTO. The agent's own cwd
		//    is this example dir (so Flue discovers its skill), but it creates the
		//    new examples/<name>/ and edits root ci.yml/README in the target repo
		//    checkout. Defaults to the current repo root when unset.
		env: {
			GH_TOKEN: process.env.GITHUB_TOKEN ?? '',
			GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? '',
			TARGET_REPO_DIR: process.env.TARGET_REPO_DIR ?? '',
		},
	}),
	tools: Object.values(githubTools),
}));
