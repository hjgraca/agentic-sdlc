# Spike: consumer → channel-keyed agent → completion, with durable memory

**Question (the load-bearing one):** can a one-shot consumer
(Lambda/Fargate-style) drive a **channel-keyed** Flue agent **to completion**
with **durable per-channel memory** — using a *supported* API, not Flue
internals? Earlier worry: `dispatch()` is fire-and-forget; does keeping channel
identity force the internal `createNodeAgentCoordinator` path?

**Answer: yes, via the supported `flue run --id` API.** ✅ Real Bedrock.

```bash
npm install
# turn 1 (process A): state a fact
flue run assistant --id channel-C123 --input '{"message":"Remember: deploy window is Tuesday 14:00 UTC."}'
# turn 2 (FRESH process, same id): recall it
flue run assistant --id channel-C123 --input '{"message":"What deploy window did I tell you?"}'
#   → "Tuesday 14:00 UTC"
# control (different id):
flue run assistant --id channel-OTHER --input '{"message":"What deploy window?"}'
#   → "I do not have it."
```

## What it proves

- **`flue run --id <channelId>` is the consumer's run-to-completion API.** Docs:
  it "starts a temporary in-process runtime, calls the resource through the
  normal application, prints the terminal result, and exits," and `--id`
  "selects the persistent agent-instance ID." No internals needed.
- **Durable per-channel memory survives across separate processes.** Turn 2 (a
  brand-new process) recalled what turn 1 stored; a different id did not. So
  channel identity + memory = `--id` + a surviving persistence adapter (`db.ts`).
- Maps directly to the platform: `SQS msg → flue run --id <channelId> --input
  <turn>` (or the built `dist/server.mjs` on Fargate receiving the dispatch).

## The bug that taught the real lesson: `db.ts` location

First two runs silently used in-memory state — turn 2 forgot everything — because
`db.ts` was at the **project root**. Flue's source root is the FIRST of
`.flue/` → `src/` → project root that exists. This project has `src/`, so
**`db.ts` must be `src/db.ts`**. At the wrong location it's silently ignored (no
error, no file created, the path string never reaches the bundle). Diagnosis
tell: `grep -c "data/flue.db" dist/server.mjs` was `0` until the file was moved
into `src/`. (`flue.config.ts` stays at the project root — different rule.)

## Notes

- `sqlite()` creates the file lazily on first persisted write, not at boot — so
  "no file yet" isn't proof of misconfiguration; the bundle-grep is.
- Uses `local()` sandbox to isolate the memory+keying claim from Daytona
  (verified separately in `spikes/daytona-adapter`).
