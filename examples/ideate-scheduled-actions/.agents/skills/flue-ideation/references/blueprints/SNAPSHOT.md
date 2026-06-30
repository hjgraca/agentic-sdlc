# Flue blueprints snapshot (provenance)

The `*.md` files alongside this one are a **vendored, pinned snapshot** of Flue's
blueprint catalog — the source-of-truth implementation guides returned by
`flue add`/`flue update`, one per supported integration.

- **Source:** https://github.com/withastro/flue/tree/607d2613eb181a5e31c28a980847e101207d9fd3/blueprints
- **Pinned commit:** `607d2613eb181a5e31c28a980847e101207d9fd3`
- **Snapshot taken:** 2026-06-30

## Why vendored, not fetched

The blueprint catalog is the highest-signal input for the ideation agent's
coverage-gap charter — it is the definitive list of channels, databases,
sandboxes, and tooling Flue ships. The agent scans it **in full, locally** every
run (a `grep`/`read` over ~40 small files), which is cheaper and more reliable
than fetching dozens of files over the network. Vendoring also keeps the
`fetch_flue_doc` tool pinned to a single host (`flueframework.com`) rather than
opening a second fetch surface to `github.com`.

## What's here

Each file is a Markdown guide with JSON frontmatter declaring its `kind`
(`channel` | `database` | `sandbox` | `tooling`). Naming: `<kind>--<name>.md`
is a specific provider; `<kind>.md` is the generic kind guide. The catalog is
the live one as of the pinned commit — providers Flue supports, regardless of
whether this repo has an example for them yet. That delta is exactly what the
agent proposes.

## Refreshing

These are blueprints, not runtime deps, so they have no lockfile. To re-pin to a
newer commit, re-run (from this `blueprints/` dir), then bump the commit + date
above:

```bash
SHA=<new-commit-sha>
gh api "repos/withastro/flue/contents/blueprints?ref=$SHA" \
  --jq '.[] | select(.type=="file") | .name' \
| while IFS= read -r f; do
    gh api "repos/withastro/flue/contents/blueprints/$f?ref=$SHA" \
      --jq '.content' | base64 -d > "$f"
  done
```
