# Spike: Daytona adapter + per-channel lifecycle against the real Daytona API

**Question:** does the adapter I wrote in `examples/assistant-slack-daytona`
(only typechecked before) actually work against the live Daytona API — auth,
SessionEnv round-trip, and per-channel create-or-reuse? This spike **imports the
real example files** (`src/sandboxes/daytona.ts` + `provision.ts`), not a copy.

**Answer: yes** — adapter is correct; reuse works under serialization. ✅

```bash
npm install
DAYTONA_API_KEY=dtn_… AWS_REGION=us-west-2 SPIKE_STAMP=$(date +%s) node spike.ts
```
(The key is passed inline at runtime; never written to a file.)

## What it proves

- **Adapter SessionEnv round-trip** on a real box: `exec` (stdout+exitCode),
  `writeFile`/`readFile`/`stat`/`readdir`/`exists`/`rm`, parent-dir creation on
  write, and the `rm({force:true})` rejection (Daytona has no force). All pass.
- **Box creation is fast** — ~420ms create.
- **Per-channel create-or-reuse** (`provision.ts`): same channel → same box;
  different channel → different box (once the label index converges, below).

## The key finding: Daytona list-by-label is eventually consistent

A freshly created box takes **~1-2s** to appear in `list({ labels })` (measured:
empty on attempts 1-2, present on attempt 3, ~2.3s total). So a back-to-back
second `sandboxForThread(sameChannel)` can miss the just-created box and create a
**duplicate**. The first spike run hit exactly this (two boxes for one channel).

**Why the platform is unaffected, and the fix:** turns for one channel are
serialized — one Slack thread dispatches one turn at a time, and the AWS platform
adds the SQS-FIFO + DynamoDB lease (see `spikes/single-writer`) keyed by channel.
So `sandboxForThread` is never called concurrently for the same key, and the
consistency window never overlaps two calls. `provision.ts` now documents this
caveat explicitly. (Do NOT call it concurrently for one key without that
serialization.)

## Teardown

Boxes are deleted in a `finally`. Note: `delete` is *also* eventually consistent
— a deleted box lingers in `list()` for a few seconds. Confirmed zero boxes
remain after settle.

## What it does NOT prove

- Behavior of the baked **skills snapshot** (`DAYTONA_SNAPSHOT`) — this spike used
  the default image; it validates the adapter/lifecycle, not skill discovery
  inside the box.
- Cost/quotas under real concurrency, or auto-stop/auto-delete timing (teardown
  is explicit here).
