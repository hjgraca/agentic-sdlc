# Spike: S3 PersistenceAdapter for Flue (best for text-heavy channels)

Durable per-channel memory on **S3** — one object per session. Validated against
Flue's 55-test contract suite on MinIO (local S3). **55/55 pass on the first try**
(the large-session test needs no special handling — S3 has no 400KB cap).

```bash
docker run -d --name minio-local -p 9100:9000 \
  -e MINIO_ROOT_USER=local -e MINIO_ROOT_PASSWORD=localsecret minio/minio server /data
AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=localsecret \
  aws s3api create-bucket --endpoint-url http://localhost:9100 --region us-east-1 --bucket flue-sessions
npx vitest run     # 55/55
```

## Why S3 over DynamoDB for "a lot of text"

Flue's SessionStore rewrites the WHOLE conversation each turn. On DynamoDB that
bills per-KB (a 1MB session ≈ 1024 write units/turn, growing as the convo grows)
and needs chunking to dodge the 400KB item cap. S3:

- **No size limit** (5TB/object) → no chunking, no Query pagination.
- **Flat per-PUT write cost** (~$0.000005/PUT) regardless of session size.
- **~11x cheaper storage** ($0.023 vs $0.25 /GB-mo).
- **Strong read-after-write since 2020** → a turn sees the prior turn's write.

The only thing DynamoDB offered that S3 lacks — atomic conditional writes — is
unnecessary here: SQS FIFO already serializes turns per channel (single writer),
so plain get/put/delete on one object is correct.

## Design

Identical shape to the DynamoDB adapter: wrap in-memory `sqlite()` for
submissions/runs/events, swap ONLY `executionStore.sessions` for S3 (3 methods:
get/put/delete one `sessions/<urlencoded-id>.json` object). Sound because each
SQS turn is a one-shot `flue run` (only the session crosses processes).

## Notes

- `load` maps S3 `NoSuchKey` → `null` (Flue's contract for an unknown session).
- `forcePathStyle` + dummy creds for MinIO; real AWS uses the Lambda role chain.
- Session ids are url-encoded into a single flat key (ids contain `:`).
