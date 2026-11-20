# {{Product}} UI/UX review rubric

<!-- Template. Replace every {{...}}. Derive criteria from the owner's goals, not from a generic
     checklist. Keep 8-10 criteria; weights are integers that sum to 100. Give the criteria that
     map directly to the owner's stated goals the highest weights. -->

Product: {{one paragraph: what it is, who uses it, where its data comes from, hard technical
constraints (framework, CSP, no-build, no backend, design system, ...).}}

## Goals (from the product owner)

<!-- Quote or closely paraphrase the user's own words. Bold the key phrases. -->
1. {{Goal 1, e.g. It's easy to see **everything in flight**.}}
2. {{Goal 2}}
3. {{Goal 3}}

## Scoring

Score every criterion from 1 to 10 using the anchors. Then compute the weighted overall score out
of 10 (sum of score × weight / 100). Be strict and calibrated: 5 is "works but unremarkable", 7 is
"good product a team would adopt", 9+ is "best-in-class ({{2-4 reference products in this
domain}} quality)".

| # | Criterion | Weight | What to look for |
| --- | --- | --- | --- |
| C1 | {{Goal 1 as a criterion}} | 15 | {{An observable test, e.g. "Within 5 seconds can I tell ...?"}} |
| C2 | {{Goal 2 as a criterion}} | 15 | {{...}} |
| C3 | {{Goal 3 as a criterion}} | 15 | {{...}} |
| C4 | {{Domain familiarity}} | 10 | {{Idioms users of this domain already know.}} |
| C5 | Actionability | 10 | {{Is the next action obvious and next to its context?}} |
| C6 | Information hierarchy and visual design | 10 | Layout, density, grouping, typography, colour semantics, consistency, use of space. |
| C7 | State, feedback and trust | 10 | Freshness, loading, empty and error states, confirmations, undo or audit. |
| C8 | Accessibility and responsiveness | 5 | Contrast, keyboard, focus, labels, colour not the only signal, narrow layouts. |
| C9 | Scalability of the design | 5 | {{Still works at realistic volume, e.g. 50 items, not only demo-sized data.}} |
| C10 | Constraint fit | 5 | Suggestions respect {{the constraints above}}; nothing that needs {{forbidden things}}. |

### Anchors (apply to each criterion)

- **1–2:** missing or actively confusing.
- **3–4:** present but weak; a user would need help to use it.
- **5–6:** works and is understandable, but plain; obvious gaps remain.
- **7–8:** good; clear and pleasant; only minor gaps.
- **9–10:** excellent; delightful; a model for others.

## Required output format

1. A table of C1–C10 with a score and a one-line justification for each.
2. **Weighted overall score** (one decimal place).
3. **Top 5 improvements** ranked by impact on the overall score. Each must be concrete and
   implementable under the constraints: what to build, where, and why.
4. **Keep:** up to 3 things that work well and must not regress.
5. **Bugs or visual defects** you can see in the screenshots (including data that disagrees
   between two views).

Keep the review under 700 words. Be specific. Reference what you see in the screenshots.
