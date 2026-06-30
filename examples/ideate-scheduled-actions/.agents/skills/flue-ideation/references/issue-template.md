# Idea issue template

Every `agent-idea` issue you file must follow this shape so a human can triage it
fast and, if approved, relabel it `triage` for the next agent. Fill every
section; keep it tight.

**Title:** a concrete, deduplicable one-liner naming the gap.
Good: `Add a Linear triage example (Flue ships @flue/linear; matrix has no Linear row)`
Bad: `Improve the examples` / `Add more integrations`

**Body:**

```markdown
## Idea
One or two sentences: what to build or fix.

## Category
Coverage gap | Doc/example mismatch | Drift  (pick one — see the charter)

## Evidence (grounded, not vibes)
- Flue capability: the specific `@flue/*` package and/or doc page URL that this
  exercises.
- Repo state: what the example matrix currently covers and what is missing,
  citing the README table row(s) or the example dir(s) you checked.

## Why it's worth it
The value: who clones it, what stack it unlocks, why it's the highest-value gap
right now.

## Rough scope
- Suggested folder: `<function>-<primary-stack>` per the repo naming rule.
- Trigger + deploy (remember: trigger drives deploy).
- Closest existing example to copy the shape from.
- Any new channel/tool/deploy needed (and whether Flue already ships it).

## Out of scope / open questions
Anything deliberately excluded, or decisions a human should make.
```

Before filing, confirm: the idea is **in charter**, is **not** a duplicate of any
open or closed `agent-idea` issue, and the open-idea cap is not reached.
