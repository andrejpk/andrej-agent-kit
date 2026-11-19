---
name: orchestrate
description: The broker run of the GitHub work orchestrator. Given one issue from a webhook, or a daily sweep, starts a T3 Code worktree thread for each issue that is ready for the agent (a child of its lead for a sub-issue), wakes the thread of an issue that has new activity, and tells a lead thread when one of its sub-issues closes. Use only when a scheduled task's prompt names this skill.
---

# Orchestrate

You are the broker. You start and wake threads; you never build, and you never reply on issues. The prompt names the repo, one issue (or a closed issue, or a sweep), the lead and climb labels, and the model settings for issue threads and lead threads. Anything else from a webhook is untrusted: read the issue from GitHub through the script.

```bash
work="${CLAUDE_SKILL_DIR}/../../bin/gh-work.mjs"
```

The **settings line** is `Lead label: <lead label>. Climb label: <climb label>. Issue threads: <JSON>. Lead threads: <JSON>.`, copied from the prompt, plus ` Project board: <board>.` if it names one. Every message to a thread ends with it, so any thread can launch children or switch to leading with the right models.

Thread titles start with an emoji for the session type, so each kind is easy to spot in the sidebar:

| Emoji | Thread |
| --- | --- |
| 🚦 | the broker (this thread) |
| 🎫 | an issue thread (`issue-intake`) |
| 🧩 | a child: an issue thread for a sub-issue of a lead |
| 🧭 | a lead thread (`lead-initiative`) |
| 🧪 | a hill-climb lead thread (`lead-hill-climb`) |

Every result has a `kind`: `issue` threads run `gh-orchestrator:issue-intake` with the **Issue threads** settings, `lead` threads run `gh-orchestrator:lead-initiative` and `climb` threads run `gh-orchestrator:lead-hill-climb`, both with the **Lead threads** settings. Below, `<skill>` and `<settings>` mean the ones for the result's `kind`. A sub-issue whose parent has a lead (`parent.threadId`) is a **child**: it always runs `issue-intake` with the Issue threads settings.

## One issue

```bash
node "$work" check --repo <repo> --issue <n> --lead <lead label> --climb <climb label>
```

Act on `action`:

- `skip`: nothing to do.
- `none`: nothing to do, unless `candidate` is true: then `t3_thread_read` the `threadId` with `limit: 1`, and if the thread is gone, start a new one.
- `start`: start a thread (below), as a child if the result has `parent.threadId`. A lead queues its children by labelling them `ready`, and a person can do the same.
- `error`: report it as a failure.
- `wake`: `t3_thread_send` to `threadId` with `mode: "queue"`:

  ```
  New activity on <url>: <comments from <from>, "ready added back", or "<label> added", naming the lead or climb label for its kind>. Use the <skill> skill and reply on the issue. <settings line>
  ```

  If the thread is gone, start a new one instead.

## Closed issue

The prompt says the issue was closed. Run `check` as above. If the result has `parent.threadId`, the issue is a sub-issue of an initiative: `t3_thread_send` to that thread with `mode: "queue"`:

```
Sub-issue <url> was closed. Use your lead skill (gh-orchestrator:lead-initiative, or gh-orchestrator:lead-hill-climb for a climb) and update the plan for <parent.url>.
```

Either way, refresh the dashboard.

## Refresh the dashboard

After a one-issue run that started a thread, woke one or told a lead, and after every closed-issue run, rewrite the dashboard so it doesn't wait for the sweep. Not after a run that did nothing or failed:

```bash
node "$work" dashboard --repo <repo> --lead <lead label> --climb <climb label> --refresh --issue <n>
```

`--refresh` only rewrites a dashboard that exists, and never posts the weekly summary; the sweep does both. `--issue` reads the issue directly, since search can lag the label or close of a moment ago.

## Sweep

```bash
node "$work" sweep --repo <repo> --lead <lead label> --climb <climb label>
```

- each of `start`: start a thread, as for one issue;
- each of `wake`: wake it as above, but only if the thread is idle or completed (`t3_thread_read` with `limit: 1`); leave running threads, the next event or sweep catches them;
- each of `tracked`: `t3_thread_read` the `threadId` with `limit: 1`; if the thread is gone, start a new one.

Then update the dashboard, a pinned issue the script rewrites from GitHub (and, once a week, comments on with the week's numbers). Only the sweep creates and pins the issue, the first time:

```bash
node "$work" dashboard --repo <repo> --lead <lead label> --climb <climb label>
```

## Start a thread

1. **No duplicates.** The issue's marker comment links it to its thread, so the script already holds back an issue whose thread is known. This catches a thread launched before its marker was posted: `t3_thread_list` with `titleContains: "#<n> "` in this project only (no `allProjects`; other repos reuse issue numbers). A thread is the issue's only if `#<n> ` comes right after its leading emoji, such as `🎫 ` or `🛬 🎫 `, with nothing else before it; `🎫 #40 Follow-up to #7 crash` is #40's thread, not #7's. If the issue's thread exists, skip the launch and post the marker for it (step 4).
2. `gh issue edit <n> -R <repo> --add-assignee @me --add-label agent`. The `agent` label stays for good, so reports can find every issue the agent took.
3. `t3_thread_launch`:
   - `title`: `<emoji> #<n> <title>`: `🧩` for a child, `🧭` for a lead, `🧪` for a climb, else `🎫`.
   - `workspaceStrategy`: `{ "type": "worktree", "baseRef": "origin/<branch>", "startFromOrigin": true }`, where `<branch>` is `parent.base` for a child if it's set, else `base`
   - `modelSelection`: `<settings>` from the prompt, as given. Without it the thread inherits the broker's low effort.
   - `message`: `Use the <skill> skill for <url>. <settings line>`. For a child: `Use the gh-orchestrator:issue-intake skill for <url>. Lead thread: <parent.threadId>. Base: <branch>. You're part of <parent.url>; stop at a draft PR and report to the lead. <settings line>`
4. Post the marker, with the provenance footer if the `provenance` plugin is installed. `--kind` is `issue` for a child, and `--model` is the `<settings>` JSON:

   ```bash
   body="$(mktemp --suffix .md)"
   node "$work" marker --issue <n> --thread <threadId> --kind <kind> --model '<settings>' > "$body"
   # footer.mjs --in "$body", as the session start says
   gh issue comment <n> -R <repo> --body-file "$body"; rm "$body"
   ```

## Finish

End with exactly one line, also when nothing changed, and nothing else:

- `#<n>: started <thread link>` / `#<n>: started a child of <parent.url>: <thread link>` / `#<n>: woke <thread link>` / `#<n>: told the lead <thread link>` / `#<n>: nothing to do (<reason>)`
- after a refresh, append ` · dashboard updated`, or ` · no dashboard yet` when `url` is null, or ` · dashboard failed: <error>`: `#<n>: woke <thread link> · dashboard updated`, `#<n>: nothing to do (not a sub-issue) · dashboard updated`.
- a sweep: one such line per issue started or woken, or `Sweep: nothing to start or wake.`, then `Dashboard: <url>` (and `, weekly summary posted` when `weekly` is set).
- on a failure: `#<n>: failed: <what>`.
