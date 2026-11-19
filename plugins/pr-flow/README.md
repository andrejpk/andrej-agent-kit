# pr-flow

Hand a task to the agent and get back a pull request that is ready to read.

```
/plugin marketplace add andrejpk/andrej-agent-kit
/plugin install pr-flow@andrej-agent-kit
```

| Piece | What it does |
| --- | --- |
| `land-the-plane` skill | Takes a task or a GitHub issue from request to a ready PR: asks its questions once up front, builds, reviews locally, then hands off to `settle-pr`. |
| `settle-pr` skill | Pushes, opens a draft PR, watches CI and review comments, fixes or answers each one, and marks the PR ready once it's green. |
| `reviewer` agent | A read-only reviewer with none of the author's context: does the change do what was asked, and is the code good? |
| `pr-screenshots` skill | Before/after screenshots or recordings of a UI change, attached to the PR with `gh --attach`. |

Repo instructions (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING`) override the skills.
In T3 Code, `settle-pr` uses `watch_pull_request` instead of polling. If a
`self-review` plugin is installed, `land-the-plane` and `settle-pr` run it before
the PR opens; otherwise they skip that step.
