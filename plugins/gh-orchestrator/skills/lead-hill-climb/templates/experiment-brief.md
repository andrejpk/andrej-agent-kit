You run experiment <E-id> of a hill climb: <parent issue url>. The lead thread is `<lead thread id>`.

**Try:** <the idea, in two or three sentences>
**Hypothesis:** <what should move, by how much, and why>
**Targets:** <breakdown parts, or "none">
**Out of scope:** <what not to touch: other parts, the eval's definitions, the splits>

## Setup

- Your worktree starts from the climb branch `<climb branch>` at `<sha>`. Work on a new branch, `<experiment branch>`.
- The climb's folder is `<climb folder>`. Read `climb.json` first: the metrics, how each is measured, its noise band, and the splits.
- Shared resources: <which ones you may use, and how to take and release them (lock files, queues)>. Hold them only while you use them. Cancel your own jobs if you stop early. Never touch anyone else's.

## Rules

1. **Log from the first minute.** Create `log/<E-id>.md` from `log/TEMPLATE.md` now, and append to it as you go: what you tried, the commands, the numbers, dead ends. It's the record if this session crashes or runs out of context.
2. **Plumbing first.** Before the full run, do one pass on a small slice to prove the change and the eval run end to end.
3. **Tune on `<tuning split>` only.** Never run, read or tune on `<holdout split>`.
4. **Measure with the eval command:** `<eval command>`. Report each metric with its `n` and CI. Report every metric in `climb.json`, not only the one you aimed at; guards matter most. Changed the eval or shared code without meaning to change results? Show the numbers are identical on `<snapshot>`.
5. **Don't game the metric.** A gain that comes from scoring mistakes more kindly, or from what the eval can't see, isn't a gain: say so in the log, even if it's the result.
6. **Commit often, on your branch, and push it:** `git push -u origin <experiment branch>`. The person follows experiments by their branches, kept or not. Never push to the climb branch, and never open a PR or merge.
7. **No secrets, raw data or images of people** in commits, the log or the ledger.

## When you're done

1. Write `ledger/<E-id>.json` with your results, in the shape of the other records:
   - `results`: per metric, `value`, `n`, `ci`, and `split` when it isn't the tuning split;
   - `commit`: your branch head;
   - `config`: settings and flags;
   - `parts`;
   - a proposed `decision` (kept, rejected or parked) with the number that decides it.

   Leave `status` as `running`: the lead decides.
2. Finish the log's "Result in one line" and "Decision proposed".
3. Commit, push, and end with a short report: the result in one line, the numbers against `<the number to beat>`, the branch, and anything the lead should look at first.

If you're blocked (the eval is broken, a resource is unavailable, the idea can't work as framed), write it in the log, push, and end with the blocker. Don't work around the eval or the splits. The lead may send you review findings later: fix each with a regression test, re-run the eval, and add the round to the log's Reviews section.
