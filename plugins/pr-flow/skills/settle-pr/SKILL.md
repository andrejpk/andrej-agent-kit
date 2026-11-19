---
name: settle-pr
description: Push a branch, open or update a GitHub PR, then monitor it until settled — watch CI and review comments (human, Copilot, other bots), fix failures, address each comment, file unrelated problems as issues, and mark the PR ready once green with every comment handled. Use when asked to make/push a PR and babysit it, "monitor the PR", "keep fixing until green", or "settle" a PR.
---

# Settle a PR

Drive a pull request from push to "genuinely ready to read": CI green, every review comment addressed, marked ready for review. Repo instructions (CLAUDE.md, CONTRIBUTING) override anything here — check them for draft policy, commit style, and required local checks before pushing.

## 1. Push and open

1. If on the default branch, create a branch first. Commit with the repo's commit style.
2. Run the repo's local checks (tests, lint, codegen checks) that CI will run — cheaper than a CI round trip.
   - If the `self-review` skill is installed and hasn't run on this commit, run it now. A hook blocks `gh pr create` until it has.
3. Push with `git push -u origin <branch>`.
4. Open the PR as a **draft** unless told otherwise: `gh pr create --draft --base <default> --title ... --body-file -`.
   - Body: summary of the change and why, then a **Testing** section stating what was actually run and what was not.
   - If the PR changes UI, add before/after screenshots with the `pr-screenshots` skill (`pr-flow:pr-screenshots`).
5. If a PR-linking tool is available (e.g. `link_pull_request` in T3 Code), link the PR right away.

### Requesting reviews

Request reviews only as the repo's instructions (AGENTS.md, CLAUDE.md, CONTRIBUTING) say: from the reviewers they name, in the way they say. Otherwise don't request any reviewer, and don't guess or go further. If a requested review is refused or fails, say so once in the readout and move on; don't retry or switch identities.

One exception: if Copilot reviewed the PR and you've handled all its comments (fixed, or replied), try to re-request its review with your current login, so it can check the fixes:

```bash
gh pr edit <PR> --add-reviewer "@copilot"
```

If that's denied or fails, note it in the readout and move on; don't try another way.

Whatever reviews arrive on their own, from humans or bots (Copilot included), are handled in step 4.

## 2. Monitor

CI and reviews land a minute or more after each push. Watch the PR in the background rather than sleeping or polling in the foreground.

**In T3 Code** (the `t3-code` MCP tools are available; they may be deferred and need loading with ToolSearch): make sure the PR is linked (`link_pull_request`), call `watch_pull_request`, and end the turn. The watch wakes you when CI or reviews change; handle each event as it comes in. It keeps running across pushes, so don't start a poller or the Monitor tool here. Unwatch in step 5.

**Elsewhere,** with the Monitor tool, run one script that emits a line per new event and exits once all checks are done (plus a short grace period for late bot comments):

```bash
PR=<number>; REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
comments() {
  { gh api "repos/$REPO/pulls/$PR/comments"  --jq '.[] | "inline \(.id) \(.user.login) \(.path):\(.line // .original_line): \(.body[0:150] | gsub("\n";" "))"'
    gh api "repos/$REPO/issues/$PR/comments" --jq '.[] | "comment \(.id) \(.user.login): \(.body[0:150] | gsub("\n";" "))"'
    gh api "repos/$REPO/pulls/$PR/reviews"   --jq '.[] | "review \(.id) \(.user.login) \(.state): \(.body[0:150] | gsub("\n";" "))"'
  } 2>/dev/null | sort
}
prev=""; seen=""
while true; do
  s=$(gh pr checks $PR --json name,bucket 2>/dev/null || echo '[]')
  cur=$(jq -r '.[] | select(.bucket!="pending") | "check \(.name): \(.bucket)"' <<<"$s" | sort)
  comm -13 <(echo "$prev") <(echo "$cur"); prev=$cur
  c=$(comments); comm -13 <(echo "$seen") <(echo "$c"); seen=$c
  if [ "$s" != "[]" ] && jq -e 'all(.bucket!="pending")' <<<"$s" >/dev/null; then
    echo "ALL CHECKS DONE"; sleep 120; c=$(comments); comm -13 <(echo "$seen") <(echo "$c"); break
  fi
  sleep 30
done
```

Re-arm the watcher after every push, and when it expires while the PR is still unsettled. Pair it with a long fallback wakeup (e.g. 20 min) if one is available, and cancel that once settled.

With neither Monitor nor a background-command tool, check after each push with `gh pr checks <PR> --watch`, then read the comments with the `gh api` calls from the `comments` function above.

## 3. Handle CI failures

- Read the failing job's log (`gh run view <run-id> --log-failed`), reproduce locally where possible, fix the root cause, push, re-arm the watcher (not needed in T3 Code, where the watch keeps running).
- Keep going until green. If a failure looks unrelated to the change (flake, infra, pre-existing breakage on the base branch), say so with evidence and ask before working around it — don't disable or skip tests to get green.
- Read summary bot comments critically (e.g. a test-count drop may just be a different comparison base) — explain anomalies rather than ignoring them.
- Keep fixes as focused as the original change. Code comments explain the code as it stands; never use them to narrate the fix or why it was needed — put that in the PR description or a reply.

## 4. Handle review comments

For each comment — human or bot:

1. **Verify the claim against the code first.** Automated reviewers are sometimes wrong, and a correct finding may deserve a different fix than the one suggested.
2. **Use your judgment** on whether the comment is right and in scope:
   - Right and in scope: fix it, push, and reply on the thread saying what changed. The explanation goes in the reply, not in a code comment like "per review". If the fix is a major change (new logic, restructuring, a different approach), run `self-review` again before pushing it, when it's installed.
   - Wrong: reply explaining why no change is needed, with evidence from the code.
   - A real problem unrelated to this PR: file it with `gh issue create` (what, where, how it was found, a link to the comment), and reply on the thread with the issue link.
3. **Ask the user** only when genuinely in doubt — you and the reviewer still disagree after you've verified the claim, or the comment would change the scope of the work. Present the comment, your assessment, and a recommended response.
4. Once a thread is handled, **resolve it**.

Useful commands:

```bash
# Reply to an inline review comment
gh api "repos/$REPO/pulls/$PR/comments/<comment-id>/replies" -f body='...'

# List unresolved review threads (with the thread id needed to resolve)
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{author{login} path body}}}}}}}' \
  -F o=<owner> -F r=<repo> -F n=$PR --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved|not)'

# Resolve a thread once addressed
gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -F id=<thread-id>
```

## 5. Settled

The PR is settled when CI is green and every review comment that arrived has a reply or fix. Then:

1. Stop watching: in T3 Code call `unwatch_pull_request`; elsewhere stop the monitor and cancel any fallback wakeup.
2. Mark the PR ready for review: `gh pr ready <PR>`. Ready means genuinely ready to read, so don't do this while any thread is unhandled or a question to the user is open.
3. Finish with a concise readout:
   - What was done, in a few lines.
   - Anything the user should look at first: comments you pushed back on, judgment calls, anything skipped, a review request that failed.
   - Follow-up issues you filed, if any, with one line each on what they're about. If none were filed, leave this out entirely.
   - End with the PR link, followed by the link to each issue you created.

