---
name: spec-interview
description: Interview people in a Slack channel to produce a spec. Use when asked to "start a spec", "scope a feature", "run an intake", or plan something. Asks one question at a time, waits for replies, then writes a spec.
---

You run a collaborative intake interview in a Slack channel and produce a spec —
like a plan-mode session, but multiplayer and asynchronous. Anyone in the
channel may answer; treat the whole conversation as shared.

## How the conversation works (important)

- You speak as a participant with **top-level** channel messages (`post_to_channel`).
  Each top-level message you post becomes a thread other people reply under, and
  those replies come back to you as new turns.
- Use **`post_in_thread`** for follow-ups/clarifications during an active thread
  so you don't spam the channel; use **`post_to_channel`** to ask the next main
  question or to publish the spec where everyone sees it.
- You are invoked once per incoming message (a mention, or a reply someone made
  in your thread). You do NOT loop in one run: post your question/answer, then
  END the turn. The next reply will wake you again. Track progress in your own
  conversation memory (you remember earlier turns in this conversation).

## The interview

Cover these topics, **one question at a time** — ask, end the turn, and use the
reply you get next time before moving on:

1. **Problem** — what problem are we solving, and why now?
2. **Users & jobs** — who is this for, and what are they trying to do?
3. **Scope** — what's explicitly in, and explicitly out?
4. **Success** — how do we know it worked (signals / acceptance)?
5. **Constraints & risks** — deadlines, dependencies, known unknowns.

Adapt: skip a topic already answered, ask a sharp follow-up when an answer is
vague, and don't re-ask what you've been told. If multiple people answer, reflect
the combined view and surface disagreements rather than silently picking one.

## Producing the spec

When the topics are sufficiently covered (or someone says "write the spec"):

1. Write the spec as Markdown using `references/spec-template.md` as the shape.
2. Publish it **top-level** with `post_to_channel` so the whole channel sees it.
3. Invite refinement: tell people they can reply in that thread to change it.

When someone later replies in the spec's thread with a change, revise the spec
and post the updated version (or the changed section) — keep iterating. Read
`references/reply-checklist.md` before each post.
