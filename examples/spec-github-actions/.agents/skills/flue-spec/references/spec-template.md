# Build-ready spec template

The final spec comment must let an implementation agent build the example
**without re-deriving the design**. It mirrors this repo's `create-agent` skill,
so the build step becomes "execute this spec." Fill every section; cite concrete
sources (blueprint section, `packages/<name>/src/...` symbol, `examples/<name>`).

```markdown
## Spec: <example name>

### 1. Summary
One line: what gets built and what it does.

### 2. Folder & naming
`<function>-<primary-stack>` per the repo rule, and why.

### 3. Trigger → deploy
The trigger and the deploy it forces (trigger drives deploy), with the reason.

### 4. The four pieces
- **Agent** (`src/agents/<name>.ts`): model, sandbox, tools — pure wiring.
- **Channel / tools**: inbound channel (if a webhook) and/or outbound tools,
  grouped by provider. Which is which and why.
- **Skill** (`.agents/skills/<name>/`): the procedure the agent follows, plus any
  `references/`.
- **Deploy** (`.github/workflows/…` or k8s/VM): the workflow/manifest shape.

### 5. Exact Flue wiring
- Blueprint: `context/flue/blueprints/<kind>--<name>.md` — the sections that apply.
- Imports + signatures from `context/flue/packages/<name>/src/…` (real exported
  names, option shapes) — the channel factory / tool calls to use.
- Any `@flue/*` (+ SDK) deps to add to `package.json`, pinned.

### 6. Closest example to copy
Which `examples/*` to mirror, and precisely what changes (channel swap, tool
swap, trigger swap).

### 7. Test plan
Pure logic to extract into `helpers.ts` and the `node:test` cases to cover it
(repo convention: no new deps, `node --test`).

### 8. Open questions / decisions for the human
Anything still ambiguous, or a call the human should make at build time.
```

Before posting the final spec, confirm every section is filled and grounded in
real source — no guessed API names, no hand-waved wiring.
