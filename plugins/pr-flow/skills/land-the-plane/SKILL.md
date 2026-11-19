---
name: land-the-plane
description: Take a handed-off task — a one-line instruction or a larger piece of work — all the way to a PR that is ready for review. Asks questions up front, builds it, reviews it locally (a reviewer subagent, then self-review), opens a draft PR, settles CI and review comments, then marks it ready. Use when the user hands over a job to finish end to end, says "land the plane", "take it from here", "finish this out", or "build this and open a PR".
argument-hint: <task, or a GitHub issue link>
---

# Land the plane

The user is handing this job over. Get it from request to a PR that is genuinely ready to read, asking as little as possible along the way. Repo instructions (CLAUDE.md, CONTRIBUTING) override anything here.

Task: $ARGUMENTS

## When to ask the user

- **Up front:** one concise batch of questions for any non-obvious decision, after reading the relevant code (step 2).
- **Later:** only when genuinely in doubt — a decision with real trade-offs the request doesn't settle, a scope change, or a PR comment where you and the reviewer (Copilot or human) still disagree after you've verified the claim.
- **Everything else:** decide, and record the decision in the PR body's **Decisions** section so the user reviews your calls, not just the diff.

## 1. Understand the task

- If running in T3 Code (the `t3-code` MCP tools are available), mark the thread first: find this thread's title with `t3_thread_list` (the entry matching `currentThreadId`), then rename it with `t3_thread_update` (`action: "rename"`, no `threadId`) to the same title prefixed with `🛬 `. Skip the rename if the title already starts with 🛬. Elsewhere, skip this.
- If the task is a GitHub issue link or number, read it with `gh issue view`, including comments.
- Read the code the change touches and the patterns around it before deciding anything.
- Size it. A small, clear change goes straight to building. Larger work gets a short plan — a checklist of steps that also goes in the PR body.

## 2. Ask (once)

If anything non-obvious is undecided, ask in one batch. Keep each question short, give your recommended answer, and prefer multiple choice. If the user says "your call", take your recommendation. If nothing needs asking, don't ask — say in one line what you're about to build and start.

## 3. Branch and capture "before"

- If on the default branch, create a branch.
- If the change affects UI, capture **before** screenshots (or a short recording) now, before editing any code. Follow the `pr-screenshots` skill (`pr-flow:pr-screenshots`).

## 4. Build

- Keep the change focused and light: touch only what the task needs, with no drive-by refactors or unrelated cleanup.
- Follow the repo's conventions; add or update tests for new behavior.
- Code comments explain the code as it stands — durable, concise, and only where needed. Never use them to tell the story of the change, what it replaced, or why it moved; that belongs in the PR description.
- Run the repo's local checks (tests, lint, type checks, codegen checks) and get them passing.
- If UI changed, capture **after** shots matching the before shots.

## 5. Local review

Two passes before anything is pushed: an independent reviewer, then your own self-review.

Run a review cycle with the `reviewer` agent from this plugin (subagent type `pr-flow:reviewer`). Give it:

- the original task, verbatim, plus the answers to any questions
- the decisions you made
- the base ref to diff against (e.g. `origin/main`)

Then, for each finding:

1. Verify it against the code. The reviewer can be wrong.
2. Fix what holds up. If you disagree, note why in your decision log.
3. A real problem unrelated to this change is not yours to fix here — note it for a follow-up issue (step 6).

Run a second round only if the first led to substantive changes. Stop after two rounds.

Then commit and run the `self-review` skill (from the `self-review` plugin) over the branch, applying its fixes. It goes last because it stamps the commit it reviewed, and a hook blocks `gh pr create` from any later commit. Stop once it has stamped: settle-pr pushes and opens the PR in step 6, with the description rules self-review sets out. If the `self-review` plugin isn't installed, skip this pass.

## 6. Hand off to settle-pr

Invoke the `settle-pr` skill (`pr-flow:settle-pr`) to push, open the draft PR, and settle it. Give it a PR body with:

- **Manual steps**, first and only if there are any: deploy steps, secrets or config to set, migrations or scripts to run by hand, other repos to release first
- **Summary:** what changed and why, linking the issue if there is one
- **Plan:** the checklist, for larger work
- **Decisions:** non-obvious calls made without asking, one line each
- **Screenshots:** before/after, side by side where it helps. Upload and embed them with the `pr-screenshots` skill.
- **Testing:** what you actually ran, and what you didn't

File any unrelated problems from step 5 as GitHub issues (`gh issue create`) and link them from the PR body.

`settle-pr` marks the PR ready once it's settled and finishes with the readout. Add to that readout the paths of any local videos and any decision the user should look at first, and include the issues filed here alongside the ones settle-pr files.
