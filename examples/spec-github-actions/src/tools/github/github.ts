import { defineTool } from '@flue/runtime';
import { Octokit } from '@octokit/rest';
import * as v from 'valibot';
import {
	flattenThread,
	isAuthorized,
	type RepoPermission,
	splitRepo,
	type ThreadComment,
} from './helpers.ts';

/**
 * GitHub tools for the spec agent. It runs an async spec interview inside a
 * GitHub **Discussion**: it reads the whole thread each cold wake, posts
 * questions / a convergence checkpoint / the final spec, and manages the
 * `speccing` label. Discussions have **no REST API** — those calls are GraphQL
 * via Octokit's `graphql()`. The one REST call is the authoritative permission
 * check (collaborator permission has no GraphQL equivalent as clean as the REST
 * endpoint).
 *
 * Tools (this agent's whole GitHub surface):
 *   - `github_check_permission`      — authoritative write/admin gate (ADR 0004)
 *   - `github_list_discussion`       — read the thread (title, body, comments)
 *   - `github_add_discussion_comment`— post a question / checkpoint / spec
 *   - `github_add_discussion_label`  — add `speccing` on kickoff
 *   - `github_remove_discussion_label`— drop `speccing` at convergence
 *
 * Auth from the environment at runtime — never hardcode tokens:
 *   GITHUB_TOKEN    Actions-provided (needs discussions: write), or a PAT locally
 *   GITHUB_API_URL  set by Actions; https://<host>/api/v3 for GHE. Octokit
 *                   defaults to https://api.github.com.
 */
const octokit = new Octokit({
	auth: process.env.GITHUB_TOKEN,
	...(process.env.GITHUB_API_URL ? { baseUrl: process.env.GITHUB_API_URL } : {}),
});

// Pure helpers (repo parsing, permission/mention/reducer logic) live in
// ./helpers.ts so this module exports ONLY tools — the agent does
// `Object.values(githubTools)`, so a non-tool export here would be a bogus tool.

const DISCUSSION_THREAD = `
	query ($owner: String!, $repo: String!, $number: Int!) {
		repository(owner: $owner, name: $repo) {
			discussion(number: $number) {
				id
				title
				body
				author { login }
				labels(first: 20) { nodes { id name } }
				comments(first: 100) {
					nodes {
						body
						author { login }
						# Threaded replies fire the same discussion_comment event, so we
						# must read them too (see flattenThread / issue #37).
						replies(first: 100) { nodes { body author { login } } }
					}
					pageInfo { hasNextPage endCursor }
				}
			}
		}
		# The viewer is this agent — used to mark which comments are our own.
		viewer { login }
	}
`;

const DISCUSSION_COMMENTS_PAGE = `
	query ($owner: String!, $repo: String!, $number: Int!, $after: String!) {
		repository(owner: $owner, name: $repo) {
			discussion(number: $number) {
				comments(first: 100, after: $after) {
					nodes {
						body
						author { login }
						replies(first: 100) { nodes { body author { login } } }
					}
					pageInfo { hasNextPage endCursor }
				}
			}
		}
	}
`;

const ADD_COMMENT = `
	mutation ($discussionId: ID!, $body: String!) {
		addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
			comment { id url }
		}
	}
`;

// Labels attach to a discussion via the generic labelable mutations.
const ADD_LABELS = `
	mutation ($labelableId: ID!, $labelIds: [ID!]!) {
		addLabelsToLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) {
			clientMutationId
		}
	}
`;

const REMOVE_LABELS = `
	mutation ($labelableId: ID!, $labelIds: [ID!]!) {
		removeLabelsFromLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) {
			clientMutationId
		}
	}
`;

const LABEL_ID = `
	query ($owner: String!, $repo: String!, $name: String!) {
		repository(owner: $owner, name: $repo) {
			label(name: $name) { id }
		}
	}
`;

const ADD_REACTION = `
	mutation ($subjectId: ID!, $content: ReactionContent!) {
		addReaction(input: { subjectId: $subjectId, content: $content }) {
			reaction { content }
		}
	}
`;

export const checkPermission = defineTool({
	name: 'github_check_permission',
	description:
		"Authoritative authorization check: does a user have write/admin permission on the repo? Call this FIRST, before any other work, with the login of the human whose comment triggered you. Returns { login, permission, authorized } where authorized is true only for write/admin. If authorized is false, STOP — do not spec, do not comment (the comment trigger is world-writable; this protects the token budget).",
	input: v.object({ repo: v.string(), username: v.string() }),
	run: async ({ input }) => {
		try {
			const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({
				...splitRepo(input.repo),
				username: input.username,
			});
			const permission = data.permission as RepoPermission;
			return JSON.stringify({
				login: input.username,
				permission,
				authorized: isAuthorized(permission),
			});
		} catch (err) {
			// A 404 here means "not a collaborator" → treat as unauthorized, not an
			// error the model should retry.
			return JSON.stringify({
				login: input.username,
				permission: 'none',
				authorized: false,
				note: `permission lookup failed (treated as unauthorized): ${String(err)}`,
			});
		}
	},
});

export const addReaction = defineTool({
	name: 'github_add_reaction',
	description:
		'React to a discussion comment as a fast acknowledgment — use 👀 (EYES) on the triggering comment right after you decide to engage, so the human sees you picked it up before the full reply (which takes a minute). Pass the comment NODE id (from the invocation message) and a content of EYES (default), THUMBS_UP, ROCKET, etc.',
	input: v.object({
		subjectId: v.string(),
		content: v.optional(v.string()),
	}),
	run: async ({ input }) => {
		try {
			const content = input.content ?? 'EYES';
			await octokit.graphql(ADD_REACTION, {
				subjectId: input.subjectId,
				content,
			});
			return `Reacted ${content} to ${input.subjectId}`;
		} catch (err) {
			return `GitHub add reaction failed: ${String(err)}`;
		}
	},
});

export const listDiscussion = defineTool({
	name: 'github_list_discussion',
	description:
		'Read a discussion thread — its title, body, labels, and ALL comments AND threaded replies in conversation order. This is your memory each run: you wake cold, so re-read the whole thread to see what has been decided and what the latest human asked. Replies are included (a human may answer via the Reply link, not just a top-level comment). Returns { id, number, title, body, author, labels: [...], comments: [{ author, isAgent, body }] } where isAgent marks your own past comments (ignore those when deciding what to do next).',
	input: v.object({ repo: v.string(), number: v.number() }),
	run: async ({ input }) => {
		try {
			const { owner, repo } = splitRepo(input.repo);
			// A comment node carries its threaded replies (issue #37): both a
			// top-level comment and a reply fire the trigger, so we must read both.
			type CommentNode = {
				body: string;
				author: { login: string } | null;
				replies: { nodes: { body: string; author: { login: string } | null }[] };
			};
			const data: {
				repository: {
					discussion: {
						id: string;
						title: string;
						body: string;
						author: { login: string } | null;
						labels: { nodes: { id: string; name: string }[] };
						comments: {
							nodes: CommentNode[];
							pageInfo: { hasNextPage: boolean; endCursor: string | null };
						};
					};
				};
				viewer: { login: string };
			} = await octokit.graphql(DISCUSSION_THREAD, {
				owner,
				repo,
				number: input.number,
			});

			const d = data.repository.discussion;
			const me = data.viewer.login;
			const raw = [...d.comments.nodes];
			let page = d.comments.pageInfo;
			while (page.hasNextPage && page.endCursor) {
				const next: {
					repository: {
						discussion: {
							comments: {
								nodes: CommentNode[];
								pageInfo: { hasNextPage: boolean; endCursor: string | null };
							};
						};
					};
				} = await octokit.graphql(DISCUSSION_COMMENTS_PAGE, {
					owner,
					repo,
					number: input.number,
					after: page.endCursor,
				});
				raw.push(...next.repository.discussion.comments.nodes);
				page = next.repository.discussion.comments.pageInfo;
			}

			// Flatten top-level comments and their replies into one ordered thread.
			const comments: ThreadComment[] = flattenThread(
				raw.map((c) => ({ body: c.body, author: c.author, replies: c.replies.nodes })),
				me,
			);

			return JSON.stringify({
				id: d.id,
				number: input.number,
				title: d.title,
				body: d.body,
				author: d.author?.login ?? '(unknown)',
				labels: d.labels.nodes.map((l) => l.name),
				comments,
			});
		} catch (err) {
			return `GitHub list discussion failed: ${String(err)}`;
		}
	},
});

export const addDiscussionComment = defineTool({
	name: 'github_add_discussion_comment',
	description:
		'Post a comment on a discussion — a batch of interview questions, the convergence checkpoint, or the final build-ready spec. Pass the discussion NODE id (the `id` from github_list_discussion), not the number. Body is GitHub-flavored Markdown.',
	input: v.object({ discussionId: v.string(), body: v.string() }),
	run: async ({ input }) => {
		try {
			const res: { addDiscussionComment: { comment: { id: string; url: string } } } =
				await octokit.graphql(ADD_COMMENT, {
					discussionId: input.discussionId,
					body: input.body,
				});
			return `Comment posted: ${res.addDiscussionComment.comment.url}`;
		} catch (err) {
			return `GitHub add discussion comment failed: ${String(err)}`;
		}
	},
});

export const addDiscussionLabel = defineTool({
	name: 'github_add_discussion_label',
	description:
		'Add a label (e.g. "speccing") to a discussion. Pass the discussion NODE id and the label name; the label must already exist in the repo. Use to mark an interview in progress on kickoff.',
	input: v.object({ repo: v.string(), discussionId: v.string(), label: v.string() }),
	run: async ({ input }) => {
		try {
			const { owner, repo } = splitRepo(input.repo);
			const q: { repository: { label: { id: string } | null } } =
				await octokit.graphql(LABEL_ID, { owner, repo, name: input.label });
			if (!q.repository.label) {
				return `Label "${input.label}" does not exist in ${input.repo} — create it once in repo settings.`;
			}
			await octokit.graphql(ADD_LABELS, {
				labelableId: input.discussionId,
				labelIds: [q.repository.label.id],
			});
			return `Label "${input.label}" added to discussion ${input.discussionId}`;
		} catch (err) {
			return `GitHub add discussion label failed: ${String(err)}`;
		}
	},
});

export const removeDiscussionLabel = defineTool({
	name: 'github_remove_discussion_label',
	description:
		'Remove a label (e.g. "speccing") from a discussion. Pass the discussion NODE id and the label name. Use at convergence, after posting the final spec, to close the interview loop.',
	input: v.object({ repo: v.string(), discussionId: v.string(), label: v.string() }),
	run: async ({ input }) => {
		try {
			const { owner, repo } = splitRepo(input.repo);
			const q: { repository: { label: { id: string } | null } } =
				await octokit.graphql(LABEL_ID, { owner, repo, name: input.label });
			if (!q.repository.label) {
				return `Label "${input.label}" does not exist in ${input.repo}.`;
			}
			await octokit.graphql(REMOVE_LABELS, {
				labelableId: input.discussionId,
				labelIds: [q.repository.label.id],
			});
			return `Label "${input.label}" removed from discussion ${input.discussionId}`;
		} catch (err) {
			return `GitHub remove discussion label failed: ${String(err)}`;
		}
	},
});
