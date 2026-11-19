---
name: lead-initiative
description: Lead a large GitHub feature or initiative from its own T3 Code thread - agree success criteria, plan sub-issues across repos with dependencies, create them, delegate each to a child thread, review the children's PRs against the plan, and keep the plan current on the issue. Use when a thread's message says to use gh-orchestrator:lead-initiative for an issue, or an issue-intake thread switches to it after a person agreed.
---

# Lead an initiative

You lead one large piece of work, the **parent issue**, for as long as it runs. A person works with you on the issue. You don't build: child threads do, one per sub-issue, each running `gh-orchestrator:issue-intake`. You plan, delegate, review fit, and keep the plan true.

## State lives on GitHub

This thread runs for the life of the initiative, and people may work with you in it directly. GitHub is the record everyone shares: keep it current, and when it disagrees with what you remember, GitHub wins. It holds:

- **The parent issue's body**: the status page people open the issue to read. Status and steps at the top, everything else collapsed below (template below).
- **The plan comment** on the parent issue: your comment starting `<!-- lead-plan -->`, pinned. It holds the phase, the settings the orchestrator reads, and the success criteria (template below).
- **Sub-issues**, linked natively under the parent, with native blocked-by dependencies.
- **Each sub-issue's marker comment**, naming its child thread.

```bash
work="${CLAUDE_SKILL_DIR}/../../bin/gh-work.mjs"
node "$work" plan --repo <repo> --issue <n>
```

`plan` prints the plan comment, the body's state (`status`: whether it has its status section yet; `editedBy`: who changed it since you last did), who commented on the parent since your last comment (`from`), and every sub-issue with its state, child `threadId`, open blockers, PRs (state, draft, review decision), `queued` (labelled `ready`, waiting for a child) and `startable` (open, not queued, no thread, no open blockers, nobody else on it).

**Every wake starts with `plan`**, since people and children change things between wakes. Then read only what changed: new comments on the parent (`gh issue view <n> --comments`, from the newest), the message that woke you, and the PRs it names. Don't reread sub-issues or code that hasn't changed.

**When `from` isn't empty, reply on the parent** before ending the turn, even briefly ("Thanks, creating the sub-issues now."). Your new comment is how the orchestrator knows those comments are handled; editing the plan comment doesn't count.

Update the plan comment when the phase, a setting or the success criteria change, with the provenance footer:

```bash
node "$work" plan-comment --repo <repo> --issue <n> --body-file <file>
```

It creates and pins the comment the first time, and edits it in place after that.

**Keep what you post short.** Lead with the point, use lists, and link to what already exists instead of repeating it: issues and PRs as `#123` or `owner/repo#123` (GitHub shows their title and state on hover, so don't restate titles), comments, the plan, CI runs, and code as permalinks (`https://github.com/<repo>/blob/<sha>/path#L10-L20`, which GitHub shows as a snippet). A one- or two-sentence summary or a short quoted snippet is fine when it saves a click. Use emoji sparingly, as status markers (✅ ❓ ⏳), never as decoration. The body's Status and Steps especially: people scan them, so they list and link, and the reasoning lives in the comments and PRs they link to.

### The issue body is the status page

Someone opening the issue should see what's happening without scrolling. On your first wake, restructure the body (template below), **without dropping anything**: the original text moves into collapsed sections, annotated with sub-issue links later. Write the whole body to a file, add the provenance footer, then:

```bash
node "$work" body --repo <repo> --issue <n> --body-file <file> --whole
```

Every write saves the current body to a local backup first and prints its path, with `chars` before and after. If the new body is shorter, check what went missing before moving on.

After that, update only the status section, between `<!-- lead-status -->` and `<!-- /lead-status -->`, whenever the state changes: a sub-issue starts, a PR is ready or merges, a decision is made, a question is opened or answered. Write the new section to a file and run the same command without `--whole`. It replaces only what's between the markers, so people's edits elsewhere stay. Never patch the body with `sed`: links carry `#` and `&`.

When `plan` shows `editedBy`, read the body before writing it: a person changed it, maybe inside the status section, and their change is either news or a correction to keep.

An initiative led before this page existed may have **Breakdown**, **Decisions** and **Next** in its plan comment: move them into the body when you restructure it, and trim the plan comment to the template.

Decisions go in the body's **Decisions** section, each with its date and who agreed, linked to where it was agreed. That section and the other collapsed ones sit outside the markers: to change them, save the current body (`gh issue view <n> -R <repo> --json body -q .body > <file>`), edit the file, and write it back with `--whole`.

### Body template

````markdown
<one line: what the initiative is>

<!-- lead-status -->
## Status

**Delivering.** 8 of 16 steps done. Settings and success criteria: [plan comment](<plan comment url>).

- ⏳ **In progress:** #12 (#20 settling), #13 (#21 ready for review), #14 (starting)
- **Next:** #15 once #20 merges
- ❓ **Waiting on @login:** event colours ([options](<comment url>)), whether 15 is its own issue ([question](<comment url>))

## Steps

| | Step | Issue → PR | |
|---|---|---|---|
| 1 | Registry setup | #8 | ✅ |
| 2 | Shell | #12 → #20 | ⏳ |
| 3 | Colour tokens | not created; ❓ event colours | |
<!-- /lead-status -->

<details>
<summary><b>Decisions</b></summary>

- <date>: … (@login, [where](<comment url>))
</details>

<details>
<summary><b>Before starting a step</b>: skills, notes from related work</summary>

…
</details>

<details>
<summary><b>Step details</b> (the original checklist)</summary>

…
</details>
````

- **Status**: the phase and progress, then three bullets: each sub-issue in flight with its PR and state (starting, settling, ready for review, waiting on X); what comes next; each open question, linked to the comment that asks it, with the person it waits on. Leave out a bullet with nothing in it.
- **Steps**: one row per step or sub-issue, ✅ done, ⏳ in flight, ❓ waiting on an answer. Work done before you started stays as ✅ rows.
- **Collapsed sections**: decisions (the issue's own and those agreed since), what to read before starting a step (skills, notes from related work), background such as how two parts fit together, and the original text. Before any sub-issues exist, Status says the phase and what you're waiting for (the plan comment link comes once it exists), and Steps lists the proposed breakdown.

### Plan comment template

```markdown
<!-- lead-plan -->
## Plan

**Phase:** understand | plan | delivering | done
**Lead thread:** `<this thread id>`
**Base:** `<default branch>` (each PR into it; or a feature branch, see Decisions)
**Children at once:** 3

### Success criteria
1. ✅ … (#20)
2. …

Status, steps and decisions: the issue body.
```

The orchestrator reads **Base** and the dashboard reads **Phase**: keep both lines as they are.

## Phases

### 1. Understand

Read the parent issue, its comments and anything it links, and enough code in each repo it touches to talk about it concretely. Restructure the body into the status page. Then post one comment on the parent: what you understand the goal to be, the open questions (each with your recommended answer), and proposed **success criteria**, numbered and checkable. @mention the issue author.

Keep the back-and-forth on the issue, not in this thread, so it outlives this session. Once a person agrees, record the criteria in the plan comment and move to Plan. If the person talks to you in the thread instead, write what was agreed into the plan comment.

### 2. Plan

Propose the breakdown in a comment, and in the body's **Steps** table, with no ✅ or ⏳ yet:

- the major components and how they fit (a short structure, a diagram in a code block if it helps);
- each sub-issue: repo, title, one-line scope, its kind (build, design, experiment, test), and what blocks it;
- design issues and experiments go first when they decide the shape of later work;
- the order, which sub-issues can run in parallel, and the branching (below);
- for each repo involved: its T3 project, and whether the orchestrator runs there (`list_scheduled_tasks` for that project shows a task whose prompt names `gh-orchestrator` and the repo). Without it, no child starts there, nobody wakes a child when a person answers on its sub-issue, and its closing doesn't reach you. Ask the person to run `/gh-orchestrator:setup <repo>` there before delegating to it.

Ask for approval. **Create nothing until a person approves the plan.** Changes they ask for go back into the proposal.

**Branching.** Default: every child PR goes straight into the repo's default branch, small and safe to merge on its own, behind a flag if it isn't usable yet. Offer a feature branch only if the issue or the person asks for one: then create it from the default branch, children base on it and target it, and one final PR merges it. The **Base** line of the plan comment names the branch: the orchestrator reads it when it starts each child, so keep its first `` `name` `` exact.

### 3. Create

For each sub-issue in the approved plan:

```bash
gh issue create -R <owner/repo> --title "<title>" --body-file <file>   # body: scope, acceptance, link to the parent
node "$work" sub-issue --parent <parent url> --child <new issue url>
node "$work" blocked-by --issue <blocked url> --by <blocker url>        # for each dependency
```

Label design and experiment sub-issues if the repo has labels for them. Don't add `ready` or assign the agent yet: that starts a child, and Delegate decides when. Put the real issue links in the **Steps** table, and set the phase to `delivering` in the plan comment and in **Status**.

### 4. Delegate

You start a child the same way a person starts any issue: label the sub-issue `ready`. The orchestrator in the sub-issue's repo sees the label, starts a worktree thread in that repo's project with the Base from the plan comment, posts the marker, and tells the child to report to you. You don't launch threads yourself, so every issue, child or not, starts the same way and shows the same state on GitHub.

```bash
gh issue edit <n> -R <owner/repo> --add-label ready
```

Label each sub-issue that `plan` marks `startable`, up to **Children at once**, counting the ones in flight: `queued`, or with a `threadId` and no merged PR. `startable` leaves out sub-issues someone else is assigned to or has an open PR for: a person took those, so track them in **Steps** and don't label them. Mark them ⏳ in **Steps** and list them under **In progress**.

The label is the control for people too. A person can label a sub-issue `ready` to start it now, or take `ready` off a queued one to hold it; respect both. If a sub-issue stays `queued` past the next daily sweep, its repo has no orchestrator: ask the person to run `/gh-orchestrator:setup <repo>` there.

Children report back to this thread with `t3_thread_send` when they have a blocking question, a draft PR ready for you, or a blocker. A question they posted on their sub-issue is for the person; answer only if it's about how the work fits the initiative.

**GitHub or the thread?** You and the children talk both ways with `t3_thread_send` (`mode: "queue"`, one or two lines, with links). If a person reviewing the initiative or a PR later would want to read it, put it on GitHub and send a one-line pointer: review feedback and the reasons for it (a comment on the child's PR), decisions (the parent issue and **Decisions** in the body), questions for a person (the parent issue). Everything else can stay between the threads: pointers, status, "Land it", nudges, quick factual answers to a child (a name, a contract, which sibling PR to look at). If an answer becomes a decision, record it. Never comment on a sub-issue: the agent's comment there would mark a person's unanswered comment as handled, and the child would miss it. Comments from the agent account don't wake threads, so a GitHub comment for a child always needs the pointer.

### 5. Land

When a child reports a draft PR:

1. Review it for function and fit, in the context of the whole initiative: `gh pr view <pr> -R <repo>` and `gh pr diff <pr> -R <repo>`. Does it do what the sub-issue and the success criteria need, and behave the way users should see it? Check it against the decisions and what sibling PRs do: the same names, contracts between repos, no duplicate work, nothing a later sub-issue depends on left out. Don't review the correctness of implementation details outside the feature: the child's local review, CI and the person reviewing the PR cover those. If something there catches your eye (a risky area, thin tests, logic that looks wrong), tell the child what and why, and ask it to get a detailed review of that part (the `pr-flow:reviewer` agent, focused on it) and to call it out in the PR description for the person reviewing.
2. If it doesn't fit, comment on the PR (`gh pr comment <pr> -R <repo>`, with the footer): what to change and why, in terms of the plan. Then send the child the link.
3. When it fits, tell the child: `Land it: run settle-pr to get this PR ready for review.`
4. When the child reports the PR is ready, comment on the PR (with the footer) and @mention the person: what it does for the initiative, which criteria it advances, what it unblocks, and anything to look at first. Request their review (`gh pr edit <pr> --add-reviewer <login>`). Then `watch_pull_request` it, so review comments, conflicts and checks wake you. Update **Status** at each of these steps.

A person approves and merges PRs. Never merge, and never tell a child to, unless the person says so.

### 6. Adjust

The orchestrator wakes you when a sub-issue closes; a watched PR wakes you on activity. After a merge, or whenever something new is learned (an experiment's result, a design decision, a child's blocker):

- mark the step ✅ in **Steps**, update **Status**, and tick any success criteria now met in the plan comment;
- add, split or drop sub-issues and re-order dependencies (`blocked-by`; close dropped ones with a comment why);
- if the plan changes meaningfully (scope, order, criteria, a new repo), post the proposed change on the parent and wait for agreement before acting on it; small corrections, just record them under **Decisions** in the body;
- then go back to step 4.

When every criterion is met and every sub-issue is closed, post a summary on the parent (what shipped, links, anything left for later as new issues), set the phase to `done` in the plan comment and in **Status**, and ask the person to close the parent.

## Finish each turn

End with one or two lines: the phase, what you did, and what you're waiting for (a person's answer, a child, a review).
