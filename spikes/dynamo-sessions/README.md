# Spike: DynamoDB PersistenceAdapter for Flue

Durable per-channel memory on **DynamoDB** (no VPC, no NAT — fits the live
serverless consumer), validated against **Flue's own contract suite** on
DynamoDB Local.

```bash
docker run -d --name ddb-local -p 8000:8000 amazon/dynamodb-local
AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local aws dynamodb create-table \
  --endpoint-url http://localhost:8000 --region us-west-2 --table-name flue-sessions \
  --attribute-definitions AttributeName=sessionId,AttributeType=S AttributeName=chunk,AttributeType=N \
  --key-schema AttributeName=sessionId,KeyType=HASH AttributeName=chunk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST
npx vitest run        # 55/55 pass
```

## Design (why it's small)

In the one-shot consumer model each SQS turn is a fresh `flue run` process —
submissions/runs/events are created and settled within that process; only the
**session** must survive across processes. So the adapter wraps in-memory
`sqlite()` for all the machinery and swaps ONLY `executionStore.sessions` for a
DynamoDB store (3 methods: save/load/delete). No reimplementation of the ~30
intricate submission-store methods.

## Two real DynamoDB limits the contract suite caught

The standard test "round-trips session images larger than a single database
value" failed twice before passing — each a production-relevant limit a growing
channel conversation WILL hit:

1. **400KB max item size** → chunk the session JSON across items keyed
   `(sessionId HASH, chunk N RANGE)`; reassemble on read, prune stale chunks on
   save, batch-delete on delete.
2. **1MB max Query page** → paginate `load` (and `chunkKeys`) via
   `LastEvaluatedKey`, or a multi-chunk session is silently truncated.

Running Flue's own `defineStoreContractTests` (vitest) is what surfaced these
before they could fail in production exactly when a channel got busy.

## Notes

- DynamoDB Local partitions by `(accessKeyId, region)` — client and
  table-creator must use the SAME creds (we pin `local`/`local` for the endpoint
  case; real AWS uses the Lambda role chain, no creds in code).
- `ConsistentRead: true` on load so a turn sees the prior turn's write.
- Table: `PAY_PER_REQUEST`, composite key. ~zero idle cost.
