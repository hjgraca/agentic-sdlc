# Spike: durable per-channel session persistence (`db.ts`)

**Question:** does a per-channel Flue agent session survive a full process
restart when backed by a durable `PersistenceAdapter`? This is the load-bearing
assumption under the AWS Claude-Tag plan — "one Claude per channel that learns
over time" only holds if the conversation, keyed by channel id, reloads after
the host process dies (Fargate task replacement, cold start, deploy).

**Answer: yes.** ✅

## What it does

`spike.ts` exercises Flue's session store across **three separate OS processes**
sharing one SQLite file (`data/flue.db`):

1. `write`  — process A saves a 1-entry session for `channel-C1`.
2. `append` — process B (fresh) loads it, adds a turn, saves 2 entries.
3. `read`   — process C (fresh) loads it and asserts turn-1's text is still there.

No model, no network — it tests the exact mechanism `db.ts` wires in
(`PersistenceAdapter.connect().executionStore.sessions.{save,load}`), so the
result is deterministic.

```bash
npm install
npm run spike
```

## Why this de-risks the AWS build

- The local `sqlite()` adapter and the production `@flue/postgres` adapter
  (→ Aurora Serverless v2) implement the **same `PersistenceAdapter` contract**.
  A green run here is the same code path that runs on AWS — only the
  `db.ts` one-liner changes:

  ```ts
  // local / single host
  import { sqlite } from '@flue/runtime/node';
  export default sqlite('./data/flue.db');

  // AWS (Aurora/Postgres) — durable across host replacement & replicas
  import { postgres } from '@flue/postgres';
  export default postgres(process.env.DATABASE_URL!);
  ```

- Flue ships `@flue/postgres` officially (no custom adapter needed), so
  "durable per-channel memory on Aurora" is a dependency + one line, not a build.

## What it does NOT prove (still open)

- **Single-writer-by-channel.** Persistence ≠ serialization. Concurrent turns for
  the same channel still need SQS-FIFO (`MessageGroupId=channelId`) or a DynamoDB
  lease — unchanged from the plan.
- **The long agent loop.** This proves session *state* reloads, not that a
  hours/days task resumes. That remains checkpoint → schedule → wake (EventBridge),
  as discussed.
- **End-to-end through the model.** Deliberately omitted to stay deterministic.
