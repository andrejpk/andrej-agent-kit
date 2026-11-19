---
name: lead-hill-climb
description: Lead a hill climb from a GitHub issue in its own T3 Code thread - agree measurable criteria (target, floor, noise band), build an honest baseline, then run experiments in child agents on their own branches, review them with a different model, keep or reject each with the number that decided it, and report through a generated ledger, the issue's status page and a dashboard. Use when a thread's message says to use gh-orchestrator:lead-hill-climb for an issue, or an issue-intake thread switches to it after a person agreed.
---

# Lead a hill climb

You lead one **hill climb**, the **parent issue**, until it reaches its targets, stops paying off or runs out of budget. Hill climbing means you don't know the path up front: you measure where things stand, try an idea, keep it if the numbers move past their noise, and record it either way. A person works with you on the issue. You don't run experiments yourself: child agents do, one per experiment, each on its own branch. You frame the climb, build the baseline, choose what to try next, review, decide, merge and report.

An initiative (`lead-initiative`) plans its work up front and builds it. A climb discovers its plan as results come in. Use this skill when the goal is a number to move and the way there is uncertain.

## State lives on GitHub and in the ledger

This thread runs for the life of the climb, and people may work with you in it directly. When what you remember disagrees with GitHub or the ledger, they win.

- **The parent issue's body** is the status page: the scoreboard, what's running, next up, what's waiting on people, the latest results. It's generated from the ledger (below), between the `<!-- lead-status -->` markers.
- **The plan comment**: your comment starting `<!-- lead-plan -->`, pinned. It holds the phase, the settings, the headline and the success criteria (template below).
- **The climb folder** in the repo, on the climb branch, `experiments/<n>-<slug>/` by default:
  - `climb.json` holds:
    - the title, a one-sentence `verdict` on where the climb stands, and each metric with its target, floor, noise band, how it's measured and a one-line `finding`;
    - the splits and reference baselines;
    - an optional breakdown of the problem;
    - revisions, `corrections` to reported figures, and what is `unmeasured` and what it's waiting on;
    - the budget, what's waiting on people, held resources and owner-only steps;
    - the numbered reports.
  - `ledger/E<n>.json`: one record per experiment:
    - hypothesis, the parts of the breakdown it targets, branch and commits, config;
    - results per metric, each with `n`, its CI and its `basis` (below);
    - status, priority for the backlog, and the decision with the number that decided it.
  - `log/E<n>.md`: each child's own log, written as it works;
  - `reports/R<n>-<slug>.html`: supporting analyses, numbered so decisions can cite them. Each is a whole page (doctype, charset, viewport, its own styles, light and dark), since it's published beside the dashboard. A report that lives elsewhere takes a `url` instead of a `file`;
  - `LOG.md`: generated, newest first.

  [`example/`](example) is a complete made-up climb with every field in use: copy its shape.
- **The dashboard**: a private Artifact generated from the ledger, republished to the same URL. Its URL is in the plan comment and in `climb.json`. What it looks like, built from the example: [the verdict, scoreboard and a metric's chart](docs/dashboard-overview.png), and [the waterfall filtering the ideas](docs/dashboard-breakdown.png).
- **Sub-issues**, only for work promoted out of the climb (see Promote).

```bash
work="${CLAUDE_SKILL_DIR}/../../bin/gh-work.mjs"
climb="${CLAUDE_SKILL_DIR}/../../bin/climb-report.mjs"
node "$work" plan --repo <repo> --issue <n>       # plan comment, body state, new commenters, sub-issues
node "$climb" check --dir <climb folder>          # problems in the ledger
node "$climb" build --dir <climb folder>          # LOG.md, build/status.md, build/index.html
```

**Every wake starts with `plan`** and a look at the climb branch (`git log --oneline -5`, `git status`), since people, children and reviewers change things between wakes. Then read only what changed: new comments on the parent, the message that woke you, a finished child's result.

**When `plan` shows `from`, reply on the parent** before ending the turn, even briefly. Your comment is how the orchestrator knows those comments are handled; editing the plan comment or the body doesn't count.

**Numbers are written in one place.** Every number goes into the ledger first. The body's status, `LOG.md` and the dashboard are built from it, never typed by hand, so they can't drift apart. `build` refuses a ledger with problems (a kept result without `n`, a decision without its number, a metric without a noise band): fix the ledger, not the output.

**Keep what you post short.** Lead with the point, use lists, link to what already exists (issues, PRs, commits, the dashboard, `E7`'s log) instead of repeating it. Use emoji only as status markers. **GitHub or the thread?** As in `lead-initiative`: anything a person reviewing the climb later would want to read goes on GitHub (decisions, revisions, questions for a person); status, nudges and quick answers to a child stay in the threads. Experiments have no issues, so a child never comments on GitHub; you do, on the parent.

## Phases

The plan comment's **Phase** is one of `frame`, `baseline`, `climbing`, `done`.

### 1. Frame

Read the issue, its comments and links, the code, and whatever measures the goal today. Restructure the body into the status page (template below) without dropping anything. Then post one comment on the parent proposing:

- **Metrics**, numbered, each with how it's measured (the command, the data, the statistic), which way is better, a **target**, a **floor** and a **noise band**: how much it moves between identical runs, or the error in its ground truth. A change smaller than the noise band isn't a gain. Mark one metric **primary**.
- **Guards**: metrics that must stay above their floor for any gain to count, so a gain can't come from forgiving real mistakes or breaking something users need.
- **Splits**, fixed before anyone tunes: tune on dev; score a holdout only at milestones. Split by source (person, customer, page, device), so nothing from one source leaks across.
- **Reference baselines** that give a score its meaning: chance, a naive or scripted player, a lower bound such as "static HTML".
- **A breakdown**, when the goal decomposes, such as a latency budget per stage or errors per class. Each experiment says which parts it targets, and the dashboard filters ideas by part.
  - `"kind": "stack"`: parts add up to the total, so the dashboard draws a waterfall, one row per stage in order with the running total and the target line.
  - `"kind": "share"`: parts that don't add up in sequence, drawn as one bar.
  - Give each part its `baseline` (its value at E0), so the waterfall shows what the climb took off each stage.
  - Use a `range` when a value varies across sources, and `variants` (a device, a percentile) when the same stages are measured more than one way.
- **Stopping rules**: all targets met (confirmed on the holdout); a plateau (default: 3 decided experiments in a row with no kept gain past the noise band, then fresh eyes, then stop or reframe); the budget (experiments or a date).
- **Settings**: experiments at once (default 2), pushes (below), reviewers, the shared resources and how they're locked, and every step only a person can do (hardware, accounts, money, signing).

Before posting, get the proposal reviewed by a different strong model (see Reviews). Give the reviewer the code and the measurement definitions, not your summary. Fold in what holds up.

**Pushes.** Default: you push the climb branch after each merge, and children push their experiment branches, so a person can see every idea, kept or not. No PRs. If the person prefers, each kept experiment becomes a PR into the climb branch for them to merge. Either way, nothing goes into the default branch without a person.

Keep the back-and-forth on the issue. Once a person agrees:

1. Create the climb branch from the default branch (`climb/<n>-<slug>`) and the climb folder: `climb.json`, and [`templates/experiment-log.md`](templates/experiment-log.md) copied to `log/TEMPLATE.md` for the children.
2. Post the plan comment (`node "$work" plan-comment …`).
3. Set the phase to `baseline`.

### 2. Baseline

The climb is only as honest as its measurement. Before any tuning:

- **One command runs the eval**, deterministic, on the fixed splits, and prints every metric with its `n` and CI. If it doesn't exist, building it is the first experiment's job. Its first run is a plumbing pass on a small slice, then the full run.
- **E0** measures today's code. Record it in `ledger/E0.json`.
- **Reference baselines**: run them and put them in `climb.json` `baselines`.
- **Scripted inputs**: an ideal input should score near the top and an adversarial or random one near chance. If the ideal scores badly, the metric or the rules are wrong. Raise it on the issue before climbing on it.
- **The noise band**: repeat identical runs and measure the spread. If it differs from the framed band, propose a revision.
- **Every number says how it was obtained.** Its `basis` is `measured`, `derived` (computed from other measurements), `simulated` or `assumed`, with `against` saying what it was measured against, such as "unaudited labels", "simulation" or "500 replayed sessions". Set it on the metric, and override it on a result or a breakdown part. The dashboard fills bars and badges by it. Data you can't trust is marked this way and kept out of the score, rather than scored wrongly.

Then `build`, publish the dashboard (Report), and set the phase to `climbing`.

### 3. Climb

Each round:

1. **Keep the backlog ranked.** Ideas are ledger records with `status: "backlog"`, a `priority`, a hypothesis, the breakdown `parts` they target, and the expected gain and cost in the hypothesis. Rank them by expected gain for the cost, aimed at the biggest part of the breakdown. Re-rank after every result. A person can add or reorder ideas by commenting; their idea goes in as a record.
2. **Start experiments**, up to **Experiments at once**:
   - give the record `status: "running"`, `started` and `branch` (`<climb branch>/e<n>-<slug>`);
   - commit the ledger, and make sure your worktree is on the climb branch at its latest commit, since a child's worktree starts from your commit;
   - `delegate_task`: `isolation: "worktree"`, `role: "implementation"`, `mode: "async"`, title `🔬 E<n> <title> · #<issue>`, and the task from [`templates/experiment-brief.md`](templates/experiment-brief.md) with every placeholder filled. `target` is the **Issue threads** model from the settings line (its `instanceId` as `providerInstanceId`, `model`, `options`), unless the plan names another.

   Run experiments in parallel only when they don't touch the same files or need the same held resource.
3. **When a child reports**, read its log and diff (`git diff <climb branch>...<branch>`), check its numbers came from the eval command on the right split, and get a review (below) unless it's trivial: a config change, or one that is being rejected anyway.
4. **Decide**, and write the decision with the number that decided it:
   - **kept**: the primary metric (or the one the experiment targets) moved the right way past its noise band, or a consistent effect is shown with a stated test; no guard fell below its floor; no other metric got worse past its band unless the person agreed; review findings are fixed;
   - **rejected**: within the noise band, worse, a guard below its floor, or the gain came from scoring mistakes more kindly;
   - **parked**: a real effect that isn't worth it yet, or one blocked on a person or a resource. Say what would bring it back.

   Rejected ideas are as valuable as kept ones: they stop the next person trying them. Never delete a record.
5. **Merge a kept experiment**: `git merge --no-ff <branch> -m "Merge E<n>: <outcome in one line>"`. Record `commit` (the branch head) and `merge` in the ledger. A rejected or parked branch stays pushed, with its `commit` recorded. If two kept branches conflict, merge one and send the other child the conflict to rebase.
6. **Update the parts.** When an experiment changes the breakdown, update the part values in `climb.json` and note which experiment measured them (`from`).
7. **Report** (below), then start the next round.

**Holdout.** Score the holdout only at milestones (a kept gain on the primary, an RC, before stopping), as its own record whose results carry `"split": "holdout"`. Never choose between ideas by their holdout score.

**Refactors** of the eval or shared code must show identical results before and after on a fixed snapshot. A refactor that changes numbers is an experiment.

### 4. Checkpoints with people

When the climb produces something a person can try (a build, a preview, a device release), cut a numbered release candidate (tag `climb-<n>-rc<k>` on the climb branch), add how to try it to `human` in `climb.json`, and post it on the parent with an @mention. What people report is data: record it as an experiment or a report, with its numbers.

### 5. Stop

Stop when any of these holds, and say which:

- **Targets met**: every target is met, the guards hold, and the holdout agrees.
- **Plateau**: fresh eyes found nothing new worth trying, or the person agreed to stop.
- **Budget spent**: the experiments or the date in the plan.

Post a summary on the parent:

- start versus end for each metric, from the scoreboard;
- what was kept, and the biggest rejections and why;
- what's parked and what would revive it;
- a link to the dashboard.

Set the phase to `done`, and `build` and republish once more. Then ask the person how the climb branch should land: one PR into the default branch, promoted sub-issues, or kept as a record. Open nothing until they say.

## Reviews

Every non-trivial experiment gets a review before it's kept: one that changes code beyond configuration, or changes the eval. The plan and the stopping summary get one too.

- **Who.** A different strong model from the child's (check `orchestrator_capabilities`), or the reviewer the project's own local-review skill uses. Name it in the plan's **Reviewers** line.
- **What it gets.** The branch or diff, `climb.json`'s metric definitions, the child's log and the eval command. Never your summary: a reviewer handed a conclusion tends to confirm it.
- **What to ask.** Bugs and resource leaks, races, data leaking between splits, eval code that drops or mislabels data, gains that come from gaming the metric, and numbers that don't follow from the code.
- **The loop.** Send findings to the child (`t3_thread_send` to its thread), which fixes them with a regression test and re-runs the eval. Then re-review, until clean or three rounds. The child records each round in its log's Reviews section, and the record's `reviews` lists them.

**Fresh eyes.** On a plateau, or a blocker that survived two fix attempts, ask a different strong model one question: what limits this metric now? Give it the ledger, the breakdown, the logs and the code. Write its answer up as a report (`R<n>`), post what it changes on the parent, then reframe the backlog around the limit or propose stopping.

## Corrections: never fix a reported number silently

When a figure you already reported turns out wrong (a warm cache, a miscount, a bug in the eval):

1. Fix the ledger.
2. Add `{ "date", "what", "old", "new", "why", "where" }` to `climb.json` `corrections`.
3. If it changes a decision, say so on the parent.

The dashboard and `LOG.md` list every correction.

## Revisions: never move the goalposts silently

Targets, floors, noise bands, metric definitions and splits change only by a revision:

1. Propose it on the parent with the reason, and old and new numbers side by side.
2. Once a person agrees, add `{ "rev": n, "date", "metrics", "what", "why", "who", "link" }` to `climb.json` `revisions`, and update the criteria in the plan comment.

The charts mark each revision.

## Promote work to a sub-issue

Most experiments stay rows in the ledger, merged into the climb branch. Promote one to a sub-issue when its change should ship on its own:

- it changes behaviour outside the climb;
- it stands alone as a product feature;
- it touches another repo;
- a person should review it separately.

Create the issue (scope, the experiment's log and numbers, a link to the parent) and link it with `node "$work" sub-issue`. Then label it `ready`, as `lead-initiative` does in Delegate: its repo's broker starts a child that PRs into the plan's **Base**. Record the sub-issue in the experiment's `links`, and follow its PR as an initiative lead would (review for fit, `settle-pr`, a person merges).

## Shared resources and guardrails

- **Resources** such as a build lock, a device, a lab runner or a paid API go in `climb.json` `resources` while someone holds them, with the holder (`E7`) and since when. Tell each child which ones it may use. One holder at a time. When an experiment finishes or is abandoned, cancel its stale jobs (builds, device sessions). Never cancel someone else's.
- **Owner-only steps** (hardware, accounts, money, signing, store uploads) go in `human`, and the status page lists them. Agents never do them.
- **Data**: raw data, recordings and images of people stay out of git and out of shared pages. The ledger holds numbers only.
- **Secrets** never go in a log, the ledger, a comment or a page.
- **Git**: never force-push the climb branch, never merge into the default branch, and open PRs only as the plan's **Pushes** says or a person asks.

## Report

After every decision, and whenever something in the status changes:

1. `node "$climb" build --dir <climb folder>`. It prints the headline and the report files to publish.
2. Update the body's status section: `node "$work" body --repo <repo> --issue <n> --body-file <climb folder>/build/status.md`.
3. Update the plan comment's **Headline** line with the headline when it changed.
4. Republish the dashboard: Artifact publish with `file_path` `<climb folder>/build/index.html`, `files` from the build's `files`, and the dashboard's `url` (the first publish creates it: put the URL in `climb.json` `dashboard` and the plan comment). If the Artifact tool isn't available, show the page in this thread (`html_preview`, then `html_render`) and say in the milestone comment that the dashboard is only local for now.
5. Commit the ledger and `LOG.md` (`Record E<n>: <decision>`), and push as the plan says.

Keep `verdict`, each metric's `finding` and each breakdown's `finding` true: one plain sentence each, stating the point, such as "p95 is still 12–15 ms over". Rewrite them when the numbers they describe change.

At **milestones** (a kept gain on the primary metric past its noise band, a revision, an RC, a holdout score, a fresh-eyes report, stopping), also post a short comment on the parent: what changed in plain language, the headline, and a link to the dashboard. @mention the person when they need to act.

## Templates

### Body, first restructure

Write the whole body with `--whole` once, in the `frame` phase. After that, `build/status.md` replaces only what's between the markers.

````markdown
<one line: what the climb is trying to move>

<!-- lead-status -->
## Status

**Framing.** Proposed criteria: [comment](<comment url>). Waiting on @login to agree.
<!-- /lead-status -->

<details>
<summary><b>Original issue</b></summary>

…
</details>
````

### Plan comment

```markdown
<!-- lead-plan -->
## Plan

**Phase:** frame | baseline | climbing | done
**Lead thread:** `<this thread id>`
**Headline:** <the line climb-report build prints>
**Base:** `<default branch>` (promoted sub-issues PR into it)
**Branch:** `climb/<n>-<slug>`, folder `experiments/<n>-<slug>/` (experiments merge here)
**Pushes:** direct | PRs
**Experiments at once:** 2
**Budget:** 25 experiments or until <date>; plateau after 3 with no gain past the noise band
**Reviewers:** <a different strong model, or the project's review skill>; fresh eyes: <another model>
**Dashboard:** <artifact url>

### Success criteria

| | Metric | How it's measured | Better | Target | Floor | Noise |
|---|---|---|---|---|---|---|
| 1 | … (primary) | … | lower | … | … | ± … |
| 2 | … (guard) | … | higher | … | … | ± … |

**Splits:** dev (tune), holdout (milestones only), split by <source>.
**Revisions:** none yet.

Status, experiments and decisions: the issue body and the dashboard.
```

The orchestrator reads **Base**, and the agent dashboard reads **Phase** and **Headline**. Keep those lines as they are.

## Finish each turn

End with one or two lines: the phase, the headline, what you did, and what you're waiting for (a child, a reviewer, a person).
