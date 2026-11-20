---
name: design-panel-review
description: Iteratively improve a UI/UX design by hill-climbing against a panel of AI judges from different model families. Builds a weighted 1-10 rubric from the owner's goals, screenshots each generation, sends fresh read-only reviewer sub-agents (e.g. Claude Opus, GPT Sol, Gemini) every round, synthesizes consensus feedback, edits, and repeats, while keeping one live-refreshing HTML report with screenshots and per-judge scores per generation. Use for "panel review", "design review rounds", "have several models grade/critique this UI", "hill climb the design", or "N rounds of UX feedback".
---

# Design panel review (multi-model UI hill climb)

Improve a working UI over several rounds. Each round, a panel of fresh judges from different
model families scores screenshots against a weighted rubric; you implement their consensus
feedback and repeat. A single self-contained `report.html` shows every generation's
screenshots and scores and refreshes itself so the user can watch progress live.

Use the bundled files relative to this skill directory:

| Path | Purpose |
| --- | --- |
| `templates/RUBRIC.md` | Weighted rubric skeleton: goals, criteria, anchors, required output format |
| `templates/BRIEF.md` | Reviewer brief skeleton with a per-round "Changed in this generation" section |
| `scripts/shoot.ps1` | Headless Edge/Chrome screenshots for a URL at several viewports |
| `scripts/build-report.mjs` | Builds the live `report.html` from `rounds.json` and `round<N>/*.png` |
| `examples/rounds.json` | Tiny `rounds.json` sample (one scored round, one partially scored) |

## 0. Defaults and setup

Unless the user says otherwise: **round 0 is the current design, unmodified**, then **3 rounds
of edits** (rounds 1-3, so four scored generations), and **three judges, one per model family**:

| id | Model | Notes |
| --- | --- | --- |
| `opus` | `claude-opus-5.5` | Concrete, harsh on hierarchy and consistency |
| `sol` | `gpt-6.2-sol` | Concrete, catches data inconsistencies |
| `gemini` | `gemini-4-argon` | Consistently the most generous scorer |

Use whatever strong models from three different families are available; the point is that
averaging across families counters a single judge's bias. If the user names models, use theirs.

Create a review workspace **outside the repository** (the session files/artifacts folder):

```
review/
  RUBRIC.md  BRIEF.md  rounds.json  report.html
  round0/desktop-full.png desktop-fold.png narrow.png
  round1/...
```

Make the UI render **deterministic demo or fixture data** (no live data, no auth) at a stable
URL, so differences between rounds come from the design, not the data. Start that server and
leave it running for the whole climb.

## 1. Write the rubric from the user's goals

Copy `templates/RUBRIC.md` and fill it in:

- Turn each goal the user stated into a criterion, in their words, and give those the highest
  weights (e.g. 15 each). Add supporting criteria: domain familiarity, actionability, hierarchy
  and visual design, state/feedback/trust, accessibility and responsiveness, scalability to real
  volumes, and constraint fit. 8-10 criteria; integer weights summing to 100.
- Give each criterion an observable test ("within 5 seconds can I tell what is running now?").
- Keep the 1-10 anchors and calibration line (5 = works but unremarkable, 7 = a team would
  adopt it, 9+ = best-in-class, naming reference products from the domain).
- Keep the required output format: criterion score table with one-line justifications,
  weighted overall, **top 5 improvements** (what / where / why, implementable under the
  constraints), a **Keep (don't regress)** list, and **visual bugs** seen in the screenshots.
- Put the product's hard constraints in the rubric so judges don't propose a new backend,
  framework, or dependency the project can't take.

Show the user the criteria and weights in one short table, then proceed (don't block on it in
autopilot).

## 2. Write the brief

Copy `templates/BRIEF.md`. Give absolute paths to `RUBRIC.md` and to the UI source (judges may
read code to understand interactions a still can't show), a top-to-bottom description of what
the screens show and what hover/click/keyboard do, the domain flow, and the read-only rule.
The final section, **"Changed in this generation (round N) versus the previous one"**, is the
only part you rewrite each round. Never mention previous scores or other judges' opinions.

## 3. Screenshot the generation

```powershell
& "<skill>\scripts\shoot.ps1" -Url "http://127.0.0.1:8787/#demo" -OutDir "<review>\round$N" -Round $N
```

Defaults: `desktop-full` 1440x3200, `desktop-fold` 1440x900, `narrow` 820x2400. Pass
`-Viewports` for other sizes (e.g. a 390px mobile shot) and keep the same set every round; list
them in `rounds.json` `shots`. `-Round` cache-busts the URL with `?r=N`.

**Look at every screenshot yourself before sending it to judges.** Fix anything broken first:
stray text such as a literal `null`, overflowing or too-wide narrow layouts, blank charts,
unfinished animations captured mid-frame (raise `-SettleMs`). Judges' time is wasted on
defects you could have seen.

## 4. Convene a fresh panel

For each judge, start a **new** background sub-agent (general-purpose, with the judge's model)
in parallel. Fresh every round: no memory of earlier rounds, so judges don't anchor on their
own previous scores. Keep the prompt short; the brief carries the context:

> Panel review, round N. Read and follow `<review>\BRIEF.md` and the `RUBRIC.md` beside it.
> Screenshots: `<review>\roundN\desktop-full.png`, `desktop-fold.png`, `narrow.png`. You are a
> fresh reviewer; read-only (do not edit any files); return your review in the rubric format.

Before the judges finish, add the round to `rounds.json` with its title, commit and changes and
empty `scores`, and rebuild the report so the user sees the round appear as **pending**.

## 5. Synthesize

When all judges have returned:

1. **Recompute each weighted overall** from the criterion scores; don't trust the judge's
   arithmetic. `build-report.mjs` recomputes too and warns on mismatches.
2. Record scores in `rounds.json` (`scores.<judge>.c` = criterion scores in rubric order,
   `overall` = the judge's stated number) and, if useful, a session SQL table.
3. Write 3-6 `feedback` lines for the round: consensus items first (raised by 2+ judges, tag
   them "All 3:" / "Opus + Sol:"), then high-value single-judge items. **Factual
   inconsistencies go first** (e.g. a chart that disagrees with the board's counts): they cost
   trust on every criterion.
4. Carry the union of the **Keep** lists forward; don't regress them.
5. Rebuild the report.

## 6. Edit, verify, commit

Implement the prioritized changes. Prefer a few substantial, consensus-backed improvements over
many cosmetic ones. Then:

- Run the project's tests and linters.
- Load the running page (a browser canvas or Playwright) and check for console/runtime errors
  and broken interactions that screenshots can't show.
- Re-shoot (step 3) and inspect the new screenshots yourself.
- Commit as `round-N redesign (<short summary>)` and record the short SHA in `rounds.json`.
- Rewrite the brief's "Changed in this generation" section in user-visible terms, including
  bugs from the previous round that are now fixed.

Then go back to step 4 for the next round. Stop after the agreed number of rounds, or earlier
if the panel average stops improving for two rounds; report that plateau instead of churning.
If a round scores lower than the previous one, say so in the report and decide (with the
user, or by reverting the regressing change) rather than hiding it.

## 7. The live report

`rounds.json` drives the report:

```json
{
  "title": "Product · UI hill-climb report",
  "judges": [{ "id": "opus", "name": "Claude Opus 5.5", "model": "claude-opus-5.5" }],
  "criteria": [["C1", "In-flight visibility", 15]],
  "shots": [{ "id": "desktop-fold", "label": "Desktop fold" }],
  "rounds": [{
    "round": 0, "title": "Baseline", "commit": "a1b2c3d",
    "changes": [], "feedback": ["All 3: ..."],
    "scores": { "opus": { "c": [7], "overall": 7.0 } }
  }]
}
```

Any number of judges, criteria and shots work; judges missing from `scores` render as
**pending** and a round with some judges is marked **partial**. See `examples/rounds.json`.

```powershell
node "<skill>\scripts\build-report.mjs" "<review>"            # -> <review>\report.html, reloads every 30 s
node "<skill>\scripts\build-report.mjs" "<review>" --share    # -> report-share.html, no auto-reload
```

What the report shows (one self-contained HTML file; screenshots are embedded as base64 data
URIs, so it is several MB):

- **Header KPIs:** number of generations, baseline panel average, latest average, gain versus
  baseline, best generation.
- **Overall score by judge:** a line chart per judge across rounds plus a dashed panel-average
  line, with the model id of each judge in the legend.
- **Panel mean per criterion:** a heatmap (criterion × round, with weights and the change from
  first to last round).
- **Generations table:** one row per round with its title and commit, the screenshots as
  thumbnails (click to enlarge), each judge's overall score, the panel average with ▲/▼ versus
  the previous round, then "Changes in this generation" and "Panel feedback → next round".
- **Criterion scores by judge:** one table per judge, criterion × round.

Keep it live:

- Build `report.html` once at the start (round 0 pending) and **rebuild it after every change
  to `rounds.json` or the screenshots**. The `<meta http-equiv="refresh">` tag reloads an open
  tab every 30 s.
- Open it for the user in a browser canvas (or tell them to open the file) and re-navigate
  with `?v=N` after each rebuild.
- **Always tell the user the absolute path of the live `report.html`.** Any copy you publish
  or share is a frozen snapshot; a user watching a shared copy will think the climb is stuck.

Sharing at the end:

- Use `--share` (no auto-reload). OneDrive and SharePoint download HTML instead of rendering
  it, so also export a PDF:
  `msedge --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="<review>\report.pdf" "<review>\report-share.html"`.
- GitHub Pages on an Enterprise Managed Users account needs an org repo where you have admin
  rights; don't assume it is available.
- Don't commit `report.html` or screenshots to the product repo unless asked; they're large.
  Attach before/after shots to the PR instead (see the `pr-screenshots` skill if installed).

## Final summary to the user

Give the score progression (panel average and each judge per round), the 3-5 changes that moved
the score most, any remaining consensus weaknesses, the live report path, and the commits.

## Worked example

A GitHub-native "software factory" dashboard, four goals from the owner (see everything in
flight; show what's active now and moving through the system; rich graphics and interactivity;
familiar software-engineering idioms). Ten criteria weighted 15/15/15/10/10/10/10/5/5/5.
Judges: Opus, Sol, Gemini; fresh each round; three viewports from a `#demo` fixture.

| Round | Panel avg | Notable change |
| --- | --- | --- |
| 0 | 5.43 | Baseline (the run first recorded 5.47 from Opus's self-reported 5.3; its criteria give 5.2) |
| 1 | 7.57 | Flight deck (stage ribbon, WIP gauges), running-now agent chips, activity chart and feed |
| 2 | 7.70 | Cumulative flow diagram, agents/waiting-on-you split, clearer PR merge gates |
| 3 | 8.17 | Flow chart anchored to live board counts (a consensus bug), gate filters, compact triage |

Round 3: Opus 7.8, Sol 8.0, Gemini 8.7. Gemini scored highest every round; Sol and Opus were
harsher and more concrete, which is why the panel spans model families.
