---
name: setup
description: Set up, migrate or tear down the GitHub work orchestrator for a repo - labels, T3 Code webhook and sweep tasks, GitHub webhooks, and a first sweep. Use when someone asks to set up, install, move, reconfigure or remove the gh-orchestrator (or the older start-ready-issues job) on a repository.
argument-hint: <owner/repo> [teardown]
---

# Set up the GitHub work orchestrator

A person runs this once per repo, in T3 Code, in the thread that will be the **broker**: a new thread in the repo's T3 project, or the existing broker when migrating. Every task created here is bound to this thread, so its runs queue one at a time and never race each other. Each run starts a fresh session, so this setup conversation isn't carried into them.

The tasks, their filters and prompts are in [`tasks.json`](tasks.json). Copy them exactly, replacing only the placeholders it lists.

Ask the person once, up front, with these defaults:

- the repo (`gh repo view <repo> --json nameWithOwner -q .nameWithOwner`, for the exact casing GitHub uses in URLs);
- issue threads: provider instance, model and effort (default: this thread's `instanceId`, read with `t3_thread_configure` and no `modelSelection`, `claude-opus-5-5`, effort `medium`). It goes into the prompts as `modelSelection` JSON;
- lead threads, for initiatives and hill climbs: the same, with effort `high` by default, since a lead plans and reviews PRs against the whole initiative;
- the lead label that routes an issue to the lead skill (default `initiative`). If the org has an issue type for this (`gh api orgs/<owner>/issue-types`), its name works too, but only a label added later starts a run, so keep a label;
- the climb label that routes an issue to the hill-climb lead (default `hill-climb-lead`);
- a GitHub project board to check for related drafts, `owner/number` (default: none);
- the daily sweep time (default `07:00`).

## 1. Check prerequisites

- The T3 Code tools are available: `schedule_task`, `t3_thread_launch`. Without them, stop: this only runs in T3 Code.
- `gh auth status` succeeds, and `gh api user -q .login` is the account the agent should work as. Confirm with the person if it looks like a person's own account; everything the agent posts and every assignment uses it.
- `gh api repos/<repo> -q .permissions`: `push` is needed to label and assign. `admin` is needed to add webhooks; without it, do everything else and give the person the hook settings (step 5) for a repo admin to add.
- The `pr-flow` plugin (for `land-the-plane` and `settle-pr`) is installed, and optionally `provenance` and `self-review`. Warn if `pr-flow` is missing; issue threads need `land-the-plane`.

## 2. Labels

```bash
gh label create ready    -R <repo> --color 0E8A16 --description "Ready for the agent to pick up"
gh label create question -R <repo> --color D876E3 --description "The agent is waiting on an answer"
gh label create wip      -R <repo> --color FBCA04 --description "The agent is working on it"
gh label create <lead-label> -R <repo> --color 5319E7 --description "Large work the agent leads: plan, sub-issues, a thread for each"
gh label create <climb-label> -R <repo> --color 1D76DB --description "A number the agent climbs: baseline, experiments, keep what moves it"
gh label create agent    -R <repo> --color BFDADC --description "The agent took this issue; kept for reports"
```

An existing label fails with "already exists". Leave it as it is.

## 3. Look for an existing setup

`list_scheduled_tasks` for this project: note any task whose prompt names `gh-orchestrator` or `start-ready-issues` for this repo, with its `webhookUrl`. Then `gh api repos/<repo>/hooks` and note the hooks whose `config.url` equals one of those URLs. Other `relay.t3.codes` hooks belong to other tasks; leave them. These are replaced in step 7. Don't delete anything yet.

## 4. Broker and tasks

1. Rename this thread to the broker title from `tasks.json` (`t3_thread_update`, `action: "rename"`).
2. Generate the webhook secret without printing it anywhere else:

   ```bash
   secret_file="$(mktemp)"; openssl rand -hex 32 > "$secret_file"
   ```

   Read it once to pass to `schedule_task` as `signature.secret`. One secret serves all the hooks. `request_secret` isn't used here because its `secretRef` is spent by one save, and the person never needs to know the value.
3. Create each task in `tasks.json` with `schedule_task`: `title`, `prompt`, `schedule`, `freshSession: true`, `bindToCurrentThread: true`. Keep each webhook task's `webhookUrl` from the result.

## 5. GitHub webhooks

One hook per webhook task, with that task's `githubEvents`:

```bash
gh api repos/<repo>/hooks --method POST \
  -f name=web -F active=true -f 'events[]=<event>' \
  -f config[url]=<webhookUrl> -f config[content_type]=json \
  -f config[secret]="$(cat "$secret_file")" -f config[insecure_ssl]=0
```

GitHub sends a `ping` right away; the filters drop it. Delete `$secret_file` after the last hook.

## 6. Broker model and first sweep

1. Set this thread's model to the broker's `modelSelection` from `tasks.json` (`t3_thread_configure`, keeping this thread's `instanceId`). Each run just runs a script and follows a short table, so low effort is enough. Issue threads get their own model from the prompt.
2. Run the sweep task once with `run_scheduled_task_now`, and check its one-line result.

## 7. Retire the old setup

Only after the new tasks and hooks exist and the sweep ran: delete the old tasks from step 3 (`delete_scheduled_task`) and their hooks (`gh api repos/<repo>/hooks/<id> --method DELETE`). Threads and marker comments carry over unchanged; the marker format is the same.

Tell the person to remove any personal copy of the old skill, such as `~/.claude/skills/start-ready-issues`, so it doesn't load beside this plugin.

Repos that an initiative's sub-issues land in need the orchestrator too, so comments there reach the child threads. Mention it in the report.

## 8. Report

The repo, the agent login, the broker thread `link`, each task with its next run time, the hooks, the first sweep's result and the dashboard issue it created, and what to do to hand an issue to the agent: add the `ready` label, or assign it to the agent account.

## Teardown

With `teardown`: find this repo's orchestrator tasks and their hooks as in step 3, then delete the tasks (`delete_scheduled_task`) and those hooks. Leave the labels, issue threads and marker comments. Report what was removed.
