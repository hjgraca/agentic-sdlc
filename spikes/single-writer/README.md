# Spike: single-writer-per-channel on real AWS

**Question:** can AWS give the Durable-Object "one writer per id" guarantee that
Claude-Tag-per-channel needs? Two mechanisms, tested against **real** SQS + DynamoDB
(account <ACCOUNT_ID>, us-west-2). No public endpoints; resources are `spike-`
prefixed and torn down in a `finally`.

**Answer: yes — with one nuance you must respect.** ✅

```bash
npm install
AWS_REGION=us-west-2 SPIKE_STAMP=$(date +%s) npm run spike
```

## What it proves

1. **SQS FIFO `MessageGroupId = channelId` serializes turns within a channel**
   while different channels run in parallel: with a one-message receive, you get
   the head of two *distinct* groups (channel-A turn 1 + channel-B turn 1), never
   channel-A turn 2 while turn 1 is in flight; turn 2 becomes deliverable only
   after turn 1 is deleted.
2. **A DynamoDB conditional-write lease gives single-owner for the long loop**
   that outlives an SQS message: two workers race, exactly one wins; a third is
   rejected while the lease is held; an expired lease is reclaimable.

## The nuance (a real learning — first run "failed" here)

FIFO does **not** cap a single `ReceiveMessage` to one message per group. With
`MaxNumberOfMessages > 1`, FIFO packs as many messages from the *same* group as
it can into one batch — so `batch=10` hands you channel-A turn 1 **and** turn 2
together (ordered, but both at once). The "only one in flight per group"
guarantee is across **subsequent** receives, not within one batched call.

**Implication for the platform:** the consumer must use **`MaxNumberOfMessages = 1`**
to get strict one-turn-at-a-time per channel — or, if it ever batches, process
the batch sequentially and not treat each message as an independent parallel turn.

## What it does NOT prove

- That the **agent loop's** ownership survives a Fargate task swap mid-turn —
  that's the DDB lease + visibility-timeout interplay, only sketched here.
- Anything about throughput/scale (FIFO is 300 msg/s without batching, 3000 with);
  fine for Slack-channel cadence, flagged for awareness.
