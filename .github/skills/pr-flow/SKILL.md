---
name: pr-flow
description: Take a task from a request or GitHub issue to a ready-for-review pull request in GitHub Copilot. Use for "land the plane", "take it from here", "settle the PR", PR lifecycle work, CI failures, review comments, local review, or before-and-after PR media.
---

# GitHub Copilot PR flow

Take a handed-off task through implementation, review, pull request creation,
and settlement. The host's native GitHub and agent tools are preferred when
available; otherwise use the repository's instructions and `git`/`gh`.
This is the portable Copilot projection of the repository's `pr-flow` Claude
plugin.

## Scope and precedence

- Follow `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING`, and other repository
  instructions before this workflow.
- Never assume a Claude/T3 command, watcher, self-review stamp, provenance
  footer, or plugin hook exists. Use only capabilities the current host offers.
- Never merge a pull request unless the user explicitly asks.
- Keep questions to decisions that materially change behavior or scope.
  Otherwise make and record a defensible call in the pull request.

## 1. Intake and branch

For an issue or pull request reference, read its complete description and
comments first. For a direct task, restate the requested outcome only if that
clarifies a concrete acceptance criterion.

Inspect the relevant code, tests, and recent related work. Decide whether the
work is small enough for one pull request. If it is not, propose a dependency
order and wait for approval before creating multiple issues or pull requests.

Work from the repository's default branch or the user's explicitly named base.
Do not edit the default branch directly. For UI work, capture matching before
and after evidence when the host and repository provide a safe browser or
screenshot workflow; store temporary media outside the repository.

## 2. Build

Keep the change focused, match repository conventions, and add or update tests
for changed behavior. Run the smallest relevant checks first, then the complete
checks required by the repository before publishing.

If a check fails, distinguish a change-caused failure from a pre-existing or
infrastructure failure. Reproduce and fix the former. Do not disable checks or
work around a failure merely to produce a green result.

## 3. Local review

Review the complete change against the original request and against the
surrounding code. Prefer a fresh, read-only review through the host's reviewer
capability. If available, use this package's `pr-flow-reviewer` custom agent;
other repositories may omit it.

Give the reviewer:

- the original task verbatim and any answered questions;
- the base ref;
- decisions made during implementation.

Verify every finding. Fix problems in scope, document unrelated concrete
follow-ups, and run the relevant checks again. Do not manufacture a finding.
One substantive follow-up review is enough unless the change itself changes
materially again.

## 4. Publish and settle

Commit in the repository's style and push the feature branch. Create a draft
pull request unless the user or repository policy explicitly requests a ready
pull request. The body should include:

- **Summary**: what changed and why, with the issue link when applicable;
- **Testing**: commands actually run and anything intentionally not run;
- **Decisions**: non-obvious calls made without user input;
- **Plan** for multi-step work, and **Manual steps** only when a person must act;
- **Screenshots** for UI changes when comparable evidence was captured.

Attach media through the repository or host's supported PR-media mechanism.
Do not commit generated screenshots or videos merely to make them visible in a
pull request.

Monitor checks with a host PR watcher when available. Otherwise use
`gh pr checks --watch`, then inspect all PR and inline issue comments. Handle
each comment:

- fix a valid in-scope problem, push it, and reply on the same thread;
- explain a disputed claim with concrete code or test evidence;
- file a separate issue for a real but unrelated problem;
- ask the user only when a material scope or trade-off remains unresolved.

Resolve an inline thread after its fix or response is posted. Re-run affected
checks after every code change.

## 5. Ready

Mark the pull request ready only when required checks are green, no review
thread is left unanswered, and no blocking user decision remains. Report the
pull request URL, a concise summary, and only the decisions or follow-ups that
need the reviewer's attention.

The detailed Claude plugin additionally automates T3-specific thread control
and monitoring. Those pieces are intentionally not required by this binding;
Copilot hosts may stop after publishing if no supported background PR watcher is
available.
