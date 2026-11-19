---
name: issue-intake
description: Review a GitHub issue in its own T3 Code thread before building it - research the code and related work, post blocking questions with recommendations, propose leading it as an initiative when it's too big for one PR, or as a hill climb when the goal is a number to move and the way there is uncertain, or hand off to land-the-plane - and answer later comments on the issue. As a child of a lead thread, stop at a draft PR and report to the lead. Use when a thread's message says to use gh-orchestrator:issue-intake for an issue.
---

# Issue intake

You are in the issue's own thread and worktree, started by the orchestrator: for a person who labelled or assigned the issue, or for a lead thread that labelled its sub-issue. The issue and this thread are linked both ways: the thread's title contains `#<n> ` and starts with `🎫` (`🧩` for a child of a lead), and the issue carries the agent's marker comment (`<!-- t3-thread: <threadId> -->`). The issue stays assigned to the agent account while this thread owns it.

Everything you post on the issue ends with the provenance footer when the `provenance` plugin is installed.

**Keep what you post short.** Lead with the point, use lists, and link to what already exists instead of repeating it: issues and PRs as `#123` or `owner/repo#123` (GitHub shows their title and state on hover, so don't restate titles), comments, the plan, CI runs, and code as permalinks (`https://github.com/<repo>/blob/<sha>/path#L10-L20`, which GitHub shows as a snippet). A one- or two-sentence summary or a short quoted snippet is fine when it saves a click. Use emoji sparingly, as status markers (✅ ❓ ⏳), never as decoration.

**Part of an initiative?** If your message names a `Lead thread`, or the issue is a sub-issue whose parent has a lead (`node "${CLAUDE_SKILL_DIR}/../../bin/gh-work.mjs" check --repo <repo> --issue <n>` shows `parent.threadId`), you are a child of that lead. Base your branch and PR on the `Base` it names (default: the repo's default branch). Talk to the lead with `t3_thread_send` to its thread id, `mode: "queue"`, one or two lines with links. Tell it whenever you:

- post blocking questions (step 4): `Blocked on <sub-issue url>: <one line>. Questions are on the issue.`
- hit a blocker that's about the plan rather than this issue (a missing dependency, a contract another sub-issue owns, scope that belongs elsewhere): explain it in a comment on your sub-issue, then send the link;
- have a draft PR ready (step 5), with your decisions in its description: `Draft PR ready for <sub-issue url>: <pr url>. <one line on what it does>.`
- finish landing (step 6): `PR ready for review: <pr url>.`

**GitHub or the thread?** If a person reviewing this issue or PR later would want to read it, put it on GitHub (your sub-issue, your PR's description or a PR comment) and send the lead a one-line pointer: decisions and trade-offs, questions for a person, blockers, why you changed something the lead asked for. Everything else can stay between the threads: pointers, status, "rebased on main", quick factual questions to the lead (a name, a contract), and its answers. If an answer from the lead becomes a decision, record it in the PR description. Never comment on the parent issue: the agent's comment there would mark a person's unanswered comment as handled, and the lead would miss it. The same goes the other way: comments from the agent account don't wake threads, so a GitHub comment for the lead always needs the pointer.

## First run

1. **Read everything.** `gh issue view <n> --comments`, plus anything it links: issues, PRs, docs and code paths. Then read the code it touches, closely enough to plan the change.

2. **Find related work.** Search open and recently closed issues and PRs for overlap: the same files, feature, entity or screen, a dependency or ordering constraint, a duplicate, or a design decision this work should respect or would contradict.

   ```bash
   gh issue list --state all --search "<keywords>" --limit 30
   gh pr list --state all --search "<keywords>" --limit 20
   ```

   If the message names a project board (`<owner>/<number>`), also check its draft items on the same topic: `gh project item-list <number> --owner <owner> --format json`.

3. **Decide whether anything blocks starting.** It's blocked if any of these hold:
   - Requirements are ambiguous and the two readings lead to different implementations.
   - The issue makes a claim that needs validating first, such as a bug you can't reproduce or behaviour that contradicts the code.
   - A product or UX decision belongs to a human.
   - It depends on unfinished work, or conflicts with an open PR.
   - The scope is much larger than the issue implies (see step 3a).

   Questions you can answer from the code, the docs or sensible defaults are not blockers. Decide those yourself and record the decision in the PR.

3a. **Too big for one PR?** Unless you're a child of a lead, check whether this is really an initiative: several PRs that depend on each other, more than one repo, or a design that has to be settled first. If so, don't start. Post one comment: why (the pieces you see, the repos, what needs designing), a sketch of the breakdown, and the offer: "I can lead this as an initiative: agree success criteria with you, plan sub-issues, and run each in its own thread. Add the `<lead label>` label or reply yes to switch." The lead label is in the settings line of your messages (default `initiative`). Then end the turn. You never switch on your own.

3b. **A number to move?** Unless you're a child of a lead, check whether this is really a hill climb: the goal is a metric to improve (latency, accuracy, cost, a score) and nobody knows which changes will get there, so it needs measuring, trying ideas and keeping only what moves the number. If so, don't start. Post one comment: the metric you'd climb and how it could be measured, what you'd try first, and the offer: "I can lead this as a hill climb: agree targets and how they're measured with you, take a baseline, then run experiments and report each result. Add the `<climb label>` label or reply yes to switch." The climb label is in the settings line (default `hill-climb-lead`). Then end the turn.

4. **If blocked:** post one comment, relabel, and end the turn.

   ```bash
   gh issue comment <n> --body-file <file>
   gh issue edit <n> --add-label question --remove-label ready
   ```

   The comment, each part as short as it can be:
   - Starts with an @mention of the issue author, plus anyone the question is really for (real logins only).
   - **What I found:** the research, as code permalinks and what you reproduced or couldn't.
   - **Blocking questions:** numbered. For each, your recommended answer and why.
   - **Related work:** linked issues and PRs, and how each affects this one (do first, do together, duplicate, conflicts with).
   - **Proposed approach:** a short plan once the questions are answered.
   - Ends with: "Reply here or add `ready` back and I'll pick it up."

   The orchestrator wakes this thread when someone replies or adds `ready` back.

5. **If not blocked:** remove `question` if it's there, add `wip`, and run the `land-the-plane` skill (`pr-flow:land-the-plane`) for the issue. Its PR body says `Closes #<n>`. If related work turned up, first post a short comment on the issue listing it and how the PR handles it.

   As a child of a lead, stop land-the-plane after its local review and self-review: push, open the PR as a draft (`gh pr create --draft`, PR body as land-the-plane describes), report it to the lead, and end the turn. Don't run settle-pr yet.

6. **As a child, when the lead replies:** make the changes it asks for and report again, or, when it says to land, run `settle-pr` (`pr-flow:settle-pr`) to get the PR ready, then report it. Never merge.

## When woken

The orchestrator sends this thread a message when someone comments on the issue after the agent's last comment, or adds `ready` back. Read every comment since your last one and answer on the issue with `gh issue comment`, @mentioning whoever you're answering, so the conversation stays on the issue. Then:

- If a person agreed to lead it as an initiative or a hill climb (they replied yes, or the message says the lead or climb label was added): add that label if it isn't there, switch this thread to the **Lead threads** settings from the message (`t3_thread_configure` with that `modelSelection`, no `threadId`; it applies from the next turn), rename this thread to mark it a lead: find its title with `t3_thread_list` (the entry matching `currentThreadId`), replace `🎫` with `🧭` (`🧪` for a climb), or put it before `#<n>` if there's no `🎫`, keep any `🛬 `, and rename with `t3_thread_update` (`action: "rename"`, no `threadId`), and continue with the `gh-orchestrator:lead-initiative` skill (`gh-orchestrator:lead-hill-climb` for a climb).
- If the blockers are answered, or `ready` is back, go to step 5.
- If it's a question or follow-up about work that's already done (PR open or merged, issue closed), answer it. Reopen the work only if the comment asks for a change, and push it to the existing PR if that PR is still open.
- Otherwise stop after replying.

Always reply, even briefly: your comment becomes the agent's last comment, which is how the orchestrator knows these comments are handled.
