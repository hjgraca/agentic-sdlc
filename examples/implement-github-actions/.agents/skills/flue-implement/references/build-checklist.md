# Build checklist — a finished Flue example

The spec is the design; this is the execution discipline. Before opening a
non-draft PR, every item must hold. (If one can't, open a draft PR and say which.)

## The four pieces exist and follow convention
- [ ] **Agent** `src/agents/<name>.ts` — pure wiring only: `model`, `sandbox`,
      `tools`. No prose, no `instructions` field.
- [ ] **Channel / tools** — inbound provider = a channel (`src/channels/`);
      outbound-only provider = tools (`src/tools/<provider>/`). Tool modules
      export only tools; pure logic lives in `helpers.ts`.
- [ ] **Skill** `.agents/skills/<name>/SKILL.md` — the procedure + any
      `references/`. Discovered at runtime; not imported.
- [ ] **Deploy** — the workflow/manifest the spec calls for.

## It builds and tests clean
- [ ] `npm install --ignore-scripts` (versions pinned in package.json — no `latest`)
- [ ] `./node_modules/.bin/tsc --noEmit` passes
- [ ] `./node_modules/.bin/flue build --target node` succeeds (agent registers)
- [ ] `npm test` passes — pure logic extracted to `helpers.ts` and covered with
      `node:test` (no new deps): `node --test --experimental-strip-types "src/**/*.test.ts"`

## Wired into the repo (finish criteria)
- [ ] Added to the CI matrix in the repo-root `.github/workflows/ci.yml`
- [ ] Row added to the root `README.md` examples table
- [ ] The example's own `README.md` is accurate (flow diagram + shape)

## Safe & clean
- [ ] No secrets, account ids, ARNs, org URLs, or live hostnames — only
      `.example` placeholders (`.env.example`, kustomization examples, etc.)
- [ ] `.gitignore` covers `node_modules`, `dist`, `.env`, `.flue`, and (if the
      agent clones anything) `context/`
- [ ] Only the new `examples/<name>/` + the CI/README wiring edits are touched
