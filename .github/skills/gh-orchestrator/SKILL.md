---
name: gh-orchestrator
description: Intake and lead GitHub issues, initiatives, and measurement-driven hill climbs with GitHub Copilot. Use for issue intake, agent-ready issue work, cross-repository planning, sub-issues, initiative leadership, baselines, experiments, or requests to run gh-orchestrator.
---

# GitHub Copilot issue orchestration

Use GitHub as the durable record while Copilot investigates, plans, delegates,
and delivers work from issues. This is the portable Copilot projection of the
repository's `gh-orchestrator` Claude plugin.

## Supported modes

Classify the request once, before editing:

| Mode | Use when | Copilot action |
| --- | --- | --- |
| Intake | One issue can become one focused pull request | Investigate, resolve blockers, then use `pr-flow` |
| Initiative | The outcome spans dependent pull requests or repositories | Agree criteria, plan sub-issues, then delegate approved work |
| Hill climb | The goal is a metric but the path to improve it is uncertain | Frame metrics, measure a baseline, run isolated experiments, retain only evidenced gains |

Do not convert ordinary ambiguous work into an initiative. Ask for approval
before creating sub-issues or changing an issue into a multi-agent program.

## Common issue intake

1. Read the issue and every relevant comment with `gh issue view` or the host's
   GitHub tools. Follow linked issues and pull requests, and inspect the code
   closely enough to identify dependencies and conflicting work.
2. Search recent issues and pull requests for the same files, behavior, entity,
   or proposed design. Record how overlap affects order or scope.
3. Treat missing product decisions, contradictory requirements, unverified bug
   claims, unfinished dependencies, and multi-repository work as blockers.
   Answer ordinary implementation details from repository conventions and
   record the decision rather than blocking.
4. For a genuine blocker, recommend an answer for every question and post all
   questions in one concise issue comment. Do not hide durable decisions or
   reviewer context only in chat or agent state.
5. Otherwise implement with the `pr-flow` skill. If the issue is part of an
   initiative, use the initiative's stated base branch and stop for lead review
   at the requested handoff point.

Keep issue comments short and link to issues, pull requests, runs, and source
permalinks instead of reproducing them. A person approves and merges pull
requests unless they explicitly delegate that authority for the current task.

## Lead an initiative

GitHub holds the status, criteria, plan, sub-issues, dependencies, and
decisions. Do not depend on hidden session memory as the source of truth.

1. **Understand:** write a concrete summary and numbered, checkable success
   criteria. Ask the person to resolve only material design questions.
2. **Plan:** propose the components, repositories, dependency order, and base
   branches. State which parts can run in parallel. Wait for explicit approval
   before creating or starting sub-issues.
3. **Create:** make each sub-issue independently actionable, link it to the
   parent, and add native blocked-by relationships where supported. Never
   label or delegate it merely because it was created.
4. **Delegate:** use isolated child sessions or agents only when the host
   exposes that capability and the plan authorizes it. Give each child the
   issue, base branch, acceptance criteria, dependencies, and reporting point.
   Do not simulate a child or claim work started when the host cannot launch it.
5. **Review:** compare each child's pull request with its sub-issue and the
   initiative's cross-repository contracts. Return concrete fit or integration
   findings; send the child back through `pr-flow` for final settlement.
6. **Adjust:** update the durable plan when results change the dependency order,
   scope, or criteria. Ask for approval before meaningful scope changes. Mark
   a criterion complete only when its linked pull request has merged.

## Lead a hill climb

Apply the measurement, ledger, review, and reporting policy below without
invoking unavailable T3 operations.

Before experiments:

- define one primary metric, guard metrics, direction, target, floor, noise
  band, fixed splits, reference baseline, and stopping rule;
- record the exact command and population behind every number;
- run an honest baseline before tuning;
- have a different read-only reviewer check measurement definitions and
  non-trivial code changes for leaks, races, split contamination, misleading
  metric changes, and gains that do not follow from the implementation;
- require a person to approve any paid, account, hardware, or security-sensitive
  step.

Run each experiment from a captured baseline in an isolated branch or child
session. Preserve rejected ideas and the measured reason for each decision.
Keep a gain only when it exceeds the noise band, guards remain above their
floors, and review findings are addressed. Never tune on holdout data or move
criteria without an explicit revision. Corrections to an already reported
number must update the source ledger and record the old value, new value,
reason, and location; do not silently overwrite reported evidence.

When working in a checkout of this repository, the portable helpers are:

```powershell
node plugins\gh-orchestrator\bin\climb-report.mjs check --dir <climb-folder>
node plugins\gh-orchestrator\bin\climb-report.mjs build --dir <climb-folder>
node plugins\gh-orchestrator\bin\gh-work.mjs plan --repo <owner/repo> --issue <number>
```

Use the repository's path conventions on the current platform. These helpers
are part of the `gh-orchestrator` plugin, not a globally installed binary. If a
separate target repository does not contain them and the host has no access to
this package checkout, do not pretend the dashboard/report contract ran; retain
the issue and experiment record using the target repository's own conventions.

## Copilot boundaries

This binding does **not** claim to provide:

- GitHub webhook filters, scheduled broker tasks, or automatic label wakeups;
- T3 thread launch, rename, configuration, send, or watch commands;
- automatic model selection or provenance footers;
- private T3 Artifact publishing or a substitute hosted dashboard;
- an unattended sweeper after the Copilot session exits.

Those remain features of the Claude/T3 plugin. Copilot can perform the
on-demand workflow above in an active session and can use a host's supported
session automation or child-session tools, if independently available. Do not
rewrite the issue as though an unavailable automation is active.

Use `pr-flow` for implementation and pull request settlement in every mode.
