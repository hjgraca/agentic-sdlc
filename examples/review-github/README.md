# review-github — review a pull request for security issues

> 📝 **Skeleton.** This example documents the intended shape and ships a starter
> skill. The tools and workflow wiring are stubs to be fleshed out — see "TODO".

A Flue agent that reviews a GitHub pull request for security issues and posts
its findings as review comments. Like `build-gitlab`, there is **no channel** —
it runs **one-shot inside a GitHub Actions workflow** and exits.

## Why no channel

The trigger is a GitHub Actions workflow (`on: pull_request`), so the workflow
*is* the trigger and `flue run` is the entry point:

```yaml
# .github/workflows/security-review.yml (sketch)
name: security-review
on:
  pull_request:
    types: [opened, synchronize]
jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write    # to post review comments
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx flue run security-review --input "{\"pr\":${{ github.event.number }}}"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

No webhook, no server — the Actions runner's checkout, the built-in
`GITHUB_TOKEN`, and the event payload are the whole environment.

## Shape

```
AGENTS.md                                  # agent framing
.agents/skills/security-review/SKILL.md     # the procedure (ships below)
src/
├── agents/security-review.ts              # model + local() sandbox + GitHub tools
└── tools/github/                           # get PR diff, post review comments
```

## TODO to complete this example

- [ ] `src/tools/github/github.ts` — get PR diff/files, post review comments
      (uses the Actions `GITHUB_TOKEN`).
- [ ] `src/agents/security-review.ts` — wire model + `local()` sandbox + tools.
- [ ] `AGENTS.md` + the security-review skill (starter included).
- [ ] `.github/workflows/security-review.yml` — the workflow that runs `flue run`.
- [ ] `package.json`, `flue.config.ts`, `tsconfig.json` (copy from `triage-jira`).

## Pattern reference

See [`../../docs/architecture.md`](../../docs/architecture.md) and the complete
[`../triage-jira/`](../triage-jira/) example.
