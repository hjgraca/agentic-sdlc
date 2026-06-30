# Context & Glossary

The ubiquitous language for this repo. Terms here have one precise meaning;
when code or docs use them, they mean exactly this.

## Terms

### Example (Reference Architecture)
A complete, independently-clonable Flue app under `examples/`. Identity is its
**trigger + deploy**, not its model or target repo (those are config). Discovery
is via the README table's columns, not the folder name.

### Example Matrix
The set of examples viewed as a grid of capabilities: work-source × code-host ×
trigger × deploy. The README table is its canonical rendering. A **coverage
gap** is a Flue-supported capability with no row in this matrix.

### Ideation Agent
A scheduled (hourly, GitHub Actions cron) Flue example that compares Flue's
documented + installed capabilities against the [[Example Matrix]] and files
GitHub issues proposing the highest-value missing example, doc/example mismatch,
or drift fix. One-shot `flue run`; most hours it files **zero** issues (silence
is the healthy default). Built as a generic example; this repo is its first
dogfooding deployment.

### Idea
A single proposal filed by the [[Ideation Agent]] as a GitHub issue carrying the
`agent-idea` label. One idea = one issue. The agent dedups new candidates
against existing open `agent-idea` issues and obeys a low cap on open ideas.

### Idea Memory
The [[Ideation Agent]] has no persistent disk between runs; the **issue tracker
is its entire memory**. Each run it lists `agent-idea` issues regardless of
state: **open** = "already proposed" (dedup target, counts toward the cap);
**closed** = "a human rejected this — do not re-suggest." Closing an
`agent-idea` issue is therefore the durable feedback signal that shapes future
runs.

### Idea Charter
What counts as a fileable [[Idea]]: (primary) a **coverage gap** — Flue ships a
capability with no example using it; (primary) a **doc/example mismatch** — docs
describe a pattern no example demonstrates, or an example contradicts the docs;
(secondary) **drift** — installed `@flue/*` exposes API/patterns the examples
don't use. Explicitly **out of charter**: freeform "improvements" and
lint-style convention nits.

### agent-idea → triage hand-off
The contract between the [[Ideation Agent]] and the existing triage agent. The
ideation agent files `agent-idea` issues; a **human** reviews and relabels good
ones `agent-idea` → `triage`; the existing root `triage.yml` then picks them up
unchanged. The hand-off is **human-gated by design** — auto-chaining
`agent-idea` → `triage` is an explicit non-goal.
