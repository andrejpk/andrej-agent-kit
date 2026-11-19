#!/usr/bin/env node
// A hill climb's ledger, turned into what people read: the parent issue's status
// section, LOG.md and the dashboard page. The ledger is the only place numbers
// are written; everything here is generated from it, so they never disagree.
//   climb-report.mjs check --dir D        problems in climb.json and ledger/*.json, as JSON
//   climb-report.mjs build --dir D        write LOG.md, build/status.md and build/index.html
// D is the climb's folder in the repo: climb.json, ledger/E<n>.json, log/E<n>.md,
// reports/. Build output goes to D/build/, which D/.gitignore keeps out of git.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

export const STATUS_START = '<!-- lead-status -->'
export const STATUS_END = '<!-- /lead-status -->'
export const STATUSES = ['kept', 'rejected', 'parked', 'running', 'backlog']
/** How a number was obtained, from most to least direct. The page fills bars and badges by it. */
export const BASES = ['measured', 'derived', 'simulated', 'assumed']
const KINDS = ['stack', 'share']
const DECIDED = new Set(['kept', 'rejected', 'parked'])
const PHASES = ['frame', 'baseline', 'climbing', 'done']
const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE = join(HERE, '..', 'skills', 'lead-hill-climb', 'report', 'template.html')
const DATA = /\/\*DATA:climb\*\/[\s\S]*?\/\*END:climb\*\//

/** Read climb.json and every ledger/E<n>.json in a climb's folder. */
export function load (dir) {
  const climb = JSON.parse(readFileSync(join(dir, 'climb.json'), 'utf8'))
  const ledger = join(dir, 'ledger')
  const files = existsSync(ledger) ? readdirSync(ledger).filter(f => /^E\d+\.json$/.test(f)) : []
  const experiments = files.map(f => ({ ...JSON.parse(readFileSync(join(ledger, f), 'utf8')), file: `ledger/${f}` }))
  return { climb, experiments }
}

const num = id => Number(String(id).slice(1))

/** Every problem that would make the reports wrong or misleading. Empty when the ledger is sound. */
export function problems (climb, experiments) {
  const out = []
  const metrics = new Map((climb.metrics ?? []).map(m => [m.id, m]))
  const parts = new Set((climb.breakdowns ?? []).flatMap(b => b.parts.map(p => p.id)))
  const reports = new Set((climb.reports ?? []).map(r => r.id))
  if (!climb.title) out.push('climb.json: no title')
  if (!PHASES.includes(climb.phase)) out.push(`climb.json: phase must be one of ${PHASES.join(', ')}`)
  if (!metrics.size) out.push('climb.json: no metrics')
  if (![...metrics.values()].some(m => m.role === 'primary')) out.push('climb.json: no metric has role "primary"')
  for (const m of metrics.values()) {
    if (!['higher', 'lower'].includes(m.better)) out.push(`metric ${m.id}: better must be "higher" or "lower"`)
    if (typeof m.target !== 'number') out.push(`metric ${m.id}: no target`)
    if (!m.how) out.push(`metric ${m.id}: no "how" (how it is measured)`)
    if (typeof m.noise !== 'number') out.push(`metric ${m.id}: no noise band (a gain smaller than it isn't a gain)`)
    if (m.basis && !BASES.includes(m.basis)) out.push(`metric ${m.id}: basis must be one of ${BASES.join(', ')}`)
  }
  for (const b of climb.breakdowns ?? []) {
    const variants = (b.variants ?? []).map(v => v.id)
    if (b.kind && !KINDS.includes(b.kind)) out.push(`breakdown ${b.id}: kind must be one of ${KINDS.join(', ')}`)
    for (const p of b.parts ?? []) {
      const where = `breakdown ${b.id}, part ${p.id}`
      if (p.basis && !BASES.includes(p.basis)) out.push(`${where}: basis must be one of ${BASES.join(', ')}`)
      for (const key of ['value', 'range', 'baseline']) {
        const v = p[key]
        if (v === undefined || v === null) {
          if (key === 'value') out.push(`${where}: no value`)
          continue
        }
        const perVariant = typeof v === 'object' && !Array.isArray(v)
        if (perVariant && !variants.length) out.push(`${where}: ${key} is per variant, but the breakdown has no variants`)
        if (perVariant) for (const id of variants) if (v[id] === undefined) out.push(`${where}: ${key} has no value for variant ${id}`)
      }
    }
  }
  for (const [i, c] of (climb.corrections ?? []).entries()) {
    for (const key of ['date', 'what', 'old', 'new', 'why']) if (!c[key]) out.push(`correction ${i + 1}: no ${key}`)
  }
  for (const [i, u] of (climb.unmeasured ?? []).entries()) if (!u.what) out.push(`unmeasured ${i + 1}: no what`)
  const ids = new Set()
  for (const e of experiments) {
    const where = e.file ?? e.id
    if (!/^E\d+$/.test(e.id ?? '')) out.push(`${where}: id must look like E7`)
    if (ids.has(e.id)) out.push(`${where}: duplicate id ${e.id}`)
    ids.add(e.id)
    if (e.file && e.file !== `ledger/${e.id}.json`) out.push(`${where}: file name doesn't match id ${e.id}`)
    if (!STATUSES.includes(e.status)) out.push(`${where}: status must be one of ${STATUSES.join(', ')}`)
    if (!e.title) out.push(`${where}: no title`)
    if (DECIDED.has(e.status) && !e.decision) out.push(`${where}: ${e.status} without a decision (say which number decided it)`)
    if (DECIDED.has(e.status) && !e.decided) out.push(`${where}: ${e.status} without a decided date`)
    if (e.status === 'kept' && !Object.keys(e.results ?? {}).length) out.push(`${where}: kept without results`)
    if (e.status === 'backlog' && typeof e.priority !== 'number') out.push(`${where}: backlog without a priority`)
    for (const [id, r] of Object.entries(e.results ?? {})) {
      if (!metrics.has(id)) out.push(`${where}: result for unknown metric ${id}`)
      if (typeof r.value !== 'number') out.push(`${where}: ${id} has no value`)
      if (r.n === undefined) out.push(`${where}: ${id} has no n (the count behind the number)`)
      if (r.basis && !BASES.includes(r.basis)) out.push(`${where}: ${id} basis must be one of ${BASES.join(', ')}`)
    }
    for (const p of e.parts ?? []) if (!parts.has(p)) out.push(`${where}: unknown breakdown part ${p}`)
    for (const r of e.reports ?? []) if (!reports.has(r)) out.push(`${where}: unknown report ${r}`)
  }
  if (experiments.length && !ids.has('E0')) out.push('ledger: no E0 (the baseline)')
  for (const r of climb.reports ?? []) if (!r.file && !r.url) out.push(`report ${r.id}: needs a file or a url`)
  return out
}

/**
 * Experiments in the order they happened: decided ones by decision date, then
 * running, then the backlog by priority. Ties go by number.
 */
export function ordered (experiments) {
  const rank = e => DECIDED.has(e.status) ? 0 : e.status === 'running' ? 1 : 2
  return [...experiments].sort((a, b) =>
    rank(a) - rank(b) ||
    (rank(a) === 2 ? (a.priority ?? 1e9) - (b.priority ?? 1e9) : String(a.decided ?? a.started ?? '').localeCompare(String(b.decided ?? b.started ?? ''))) ||
    num(a.id) - num(b.id))
}

/** A metric's own split: the one it is tuned on. Results on another split (a holdout) are shown, never climbed on. */
const splitOf = m => m.split ?? 'dev'
const onSplit = (r, m) => r && (r.split ?? splitOf(m)) === splitOf(m)

/** The kept value of a metric just before `index` in the order (the number an experiment had to beat). */
export function valueBefore (metric, list, index) {
  for (let i = index - 1; i >= 0; i--) {
    const e = list[i]
    const r = e.results?.[metric.id]
    if (e.status === 'kept' && onSplit(r, metric)) return { value: r.value, id: e.id }
  }
  return null
}

/** How far a change moved a metric, in its "better" direction (positive is better). */
export const gain = (metric, from, to) => metric.better === 'lower' ? from - to : to - from

/** Where a value stands against the metric's target and floor. */
export function standing (metric, value) {
  if (value === null || value === undefined) return 'none'
  const atLeast = (v, t) => metric.better === 'lower' ? v <= t : v >= t
  if (atLeast(value, metric.target)) return 'target'
  if (typeof metric.floor === 'number' && atLeast(value, metric.floor)) return 'floor'
  return 'below'
}

/** A number as the metric shows it. */
export function fmt (value, metric = {}) {
  if (value === null || value === undefined) return '–'
  const d = metric.decimals ?? (Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2)
  const text = Number(value.toFixed(d)).toLocaleString('en-US', { maximumFractionDigits: d })
  return metric.unit ? `${text} ${metric.unit}` : text
}

function link (climb, kind, value) {
  if (!value) return null
  if (/^https?:\/\//.test(String(value))) return String(value)
  const repo = climb.repo && `https://github.com/${climb.repo}`
  if (!repo) return null
  if (kind === 'branch') return `${repo}/tree/${value}`
  if (kind === 'commit') return `${repo}/commit/${value}`
  if (kind === 'pr') return `${repo}/pull/${value}`
  if (kind === 'file') return climb.branch ? `${repo}/blob/${climb.branch}/${climb.path ? climb.path + '/' : ''}${value}` : null
  return null
}

/** How a result was obtained: its own basis, else its metric's (default measured), and what it was measured against. */
function evidence (r, m) {
  return { basis: r.basis ?? m.basis ?? 'measured', against: r.against ?? m.against ?? null, source: r.source ?? null }
}

/** A value given once for every variant, or per variant as `{ variantId: value }`. */
const forVariant = (x, id) => x !== null && typeof x === 'object' && !Array.isArray(x) ? x[id] ?? null : x ?? null

/**
 * A breakdown of the problem: its parts per variant (such as a device or a
 * percentile), with ranges, baselines and running totals, and how many ideas
 * aimed at each part. `stack` parts add up to a total (a latency budget);
 * `share` parts don't have to.
 */
export function breakdownView (b, experimentViews) {
  const variants = b.variants?.length ? b.variants : [{ id: 'all', label: '' }]
  const parts = b.parts.map(p => {
    const aimed = experimentViews.filter(e => e.parts.includes(p.id))
    const tried = aimed.filter(e => e.status !== 'backlog')
    const values = Object.fromEntries(variants.map(v => [v.id, { value: forVariant(p.value, v.id), range: forVariant(p.range, v.id), baseline: forVariant(p.baseline, v.id) }]))
    return {
      id: p.id, label: p.label, group: p.group ?? null, basis: p.basis ?? 'measured', source: p.source ?? null, against: p.against ?? null,
      note: p.note ?? null, from: p.from ?? null, values,
      tried: tried.length, kept: tried.filter(e => e.status === 'kept').length, queued: aimed.length - tried.length
    }
  })
  const totals = Object.fromEntries(variants.map(v => {
    const vals = parts.map(p => p.values[v.id])
    const sum = pick => vals.reduce((s, x) => s + (pick(x) ?? 0), 0)
    const hasBaseline = vals.some(x => x.baseline !== null)
    const value = sum(x => x.value)
    return [v.id, {
      value,
      lo: sum(x => x.range ? x.range[0] : x.value),
      hi: sum(x => x.range ? x.range[1] : x.value),
      baseline: hasBaseline ? sum(x => x.baseline ?? x.value) : null
    }]
  }))
  for (const p of parts) for (const v of variants) p.values[v.id].share = totals[v.id].value ? (p.values[v.id].value ?? 0) / totals[v.id].value : 0
  return {
    id: b.id, title: b.title, kind: b.kind ?? 'stack', metric: b.metric ?? null, unit: b.unit ?? null, target: b.target ?? null,
    finding: b.finding ?? null, note: b.note ?? null, variants: b.variants?.length ? variants : [], parts, totals
  }
}

/** Everything the reports show, computed once: the page and the markdown only lay it out. */
export function view (climb, experiments, now = new Date()) {
  const list = ordered(experiments)
  const metrics = climb.metrics.map(m => ({ ...m, unit: m.unit ?? '' }))
  const byId = new Map(metrics.map(m => [m.id, m]))
  const decided = list.filter(e => DECIDED.has(e.status))
  const baseline = list.find(e => e.id === 'E0')
  // Revisions sit before the first experiment decided on or after their date.
  const revAt = date => {
    const i = decided.findIndex(e => String(e.decided) >= String(date))
    return i < 0 ? decided.length : i
  }

  const metricViews = metrics.map(m => {
    const points = []
    decided.forEach((e, x) => {
      const r = e.results?.[m.id]
      if (!r) return
      points.push({ x, id: e.id, title: e.title, status: e.status, value: r.value, n: r.n ?? null, ci: r.ci ?? null, split: r.split ?? splitOf(m), holdout: !onSplit(r, m), ...evidence(r, m) })
    })
    const kept = points.filter(p => p.status === 'kept' && !p.holdout)
    const current = kept.at(-1) ?? null
    const holdout = points.filter(p => p.holdout).at(-1) ?? null
    const base = baseline?.results?.[m.id]
    return {
      ...m,
      baseline: base ? { value: base.value, id: 'E0', n: base.n ?? null, ci: base.ci ?? null } : null,
      current: current && { value: current.value, id: current.id, n: current.n, ci: current.ci, basis: current.basis, against: current.against, source: current.source },
      holdout: holdout && { value: holdout.value, id: holdout.id, n: holdout.n, ci: holdout.ci, split: holdout.split },
      standing: standing(m, current?.value),
      references: (climb.baselines ?? []).filter(b => typeof b.values?.[m.id] === 'number').map(b => ({ label: b.label, value: b.values[m.id] })),
      points,
      revisions: (climb.revisions ?? []).filter(r => !r.metrics || r.metrics.includes(m.id)).map(r => ({ rev: r.rev, what: r.what, x: revAt(r.date) }))
    }
  })

  const primary = metricViews.find(m => m.role === 'primary')
  const experimentViews = list.map((e, i) => {
    const results = Object.entries(e.results ?? {}).filter(([id]) => byId.has(id)).map(([id, r]) => {
      const m = byId.get(id)
      const before = onSplit(r, m) ? (typeof r.was === 'number' ? { value: r.was } : valueBefore(m, list, i)) : null
      const delta = before ? gain(m, before.value, r.value) : null
      return {
        metric: id, name: m.name, short: m.short ?? m.name, unit: m.unit, decimals: m.decimals, better: m.better, value: r.value, was: before?.value ?? null,
        gain: delta, beyondNoise: delta === null ? null : Math.abs(delta) > (m.noise ?? 0), n: r.n ?? null, ci: r.ci ?? null,
        split: r.split ?? splitOf(m), holdout: !onSplit(r, m), ...evidence(r, m)
      }
    })
    const links = [
      ['log', link(climb, 'file', e.log)],
      ['branch', link(climb, 'branch', e.branch)],
      ['commit', link(climb, 'commit', e.commit)],
      ['merge', link(climb, 'commit', e.merge)],
      ['PR', link(climb, 'pr', e.pr)],
      ...(e.links ?? []).map(l => [l.label, l.url])
    ].filter(([, url]) => url).map(([label, url]) => ({ label, url }))
    const main = results.find(r => r.metric === primary?.id && !r.holdout)
    return {
      id: e.id, title: e.title, status: e.status, priority: e.priority ?? null, area: e.area ?? null, parts: e.parts ?? [],
      hypothesis: e.hypothesis ?? '', started: e.started ?? null, decided: e.decided ?? null, by: e.by ?? null,
      decision: e.decision ?? '', results, links, reports: e.reports ?? [], gain: main?.gain ?? null
    }
  })

  const breakdowns = (climb.breakdowns ?? []).map(b => breakdownView(b, experimentViews))
  const measured = new Set(metricViews.filter(m => m.points.length).map(m => m.id))

  const count = s => experimentViews.filter(e => e.status === s).length
  return {
    title: climb.title,
    summary: climb.summary ?? '',
    phase: climb.phase,
    repo: climb.repo ?? null,
    issue: climb.issue ? { n: climb.issue, url: climb.repo ? `https://github.com/${climb.repo}/issues/${climb.issue}` : null } : null,
    branch: climb.branch ? { name: climb.branch, url: link(climb, 'branch', climb.branch) } : null,
    plan: climb.plan ?? null,
    dashboard: climb.dashboard ?? null,
    ledger: link(climb, 'file', 'ledger'),
    updated: now.toISOString().slice(0, 10),
    headline: headline(metricViews),
    metrics: metricViews,
    order: decided.map(e => e.id),
    experiments: experimentViews,
    breakdowns,
    reports: (climb.reports ?? []).map(r => ({ ...r, href: r.url ?? r.file })),
    revisions: climb.revisions ?? [],
    corrections: (climb.corrections ?? []).map(c => ({ ...c, whereUrl: c.where ? (/^https?:/.test(c.where) ? c.where : link(climb, 'file', c.where)) : null })),
    // Listed gaps first, then any metric with no result at all.
    unmeasured: [
      ...(climb.unmeasured ?? []).map(u => ({ what: u.what, metrics: u.metrics ?? [], waiting: u.waiting ?? null })),
      ...metricViews.filter(m => !measured.has(m.id) && !(climb.unmeasured ?? []).some(u => u.metrics?.includes(m.id))).map(m => ({ what: m.name, metrics: [m.id], waiting: null }))
    ],
    verdict: climb.verdict ?? null,
    waiting: climb.waiting ?? [],
    resources: climb.resources ?? [],
    human: climb.human ?? [],
    budget: climb.budget ?? null,
    counts: { total: experimentViews.length, decided: decided.length, ...Object.fromEntries(STATUSES.map(s => [s, count(s)])) }
  }
}

/** The one-line scoreboard for the plan comment's **Headline:** line and the agent dashboard. */
export function headline (metricViews) {
  const m = metricViews.find(v => v.role === 'primary')
  if (!m) return ''
  const now = m.current ? `${fmt(m.current.value, m)} (${m.current.id})` : 'no result yet'
  const mark = m.standing === 'target' ? ' ✅' : ''
  return `${m.name} ${now} → target ${fmt(m.target, m)}${mark}`
}

const cell = text => String(text ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ')
const md = (label, url) => url ? `[${label}](${url})` : label
const STANDING = { target: '✅ target', floor: '➖ above floor', below: '⏳ below floor', none: '⏳ not measured' }
const ICON = { kept: '✅', rejected: '✖️', parked: '⏸️', running: '⏳', backlog: '📋' }

function resultText (r) {
  const m = { unit: r.unit, decimals: r.decimals }
  const ci = r.ci ? ` [${fmt(r.ci[0], { decimals: r.decimals })}–${fmt(r.ci[1], { decimals: r.decimals })}]` : ''
  const n = r.n !== null ? `, n ${r.n}` : ''
  const split = (r.holdout ? ` on ${r.split}` : '') + (r.basis && r.basis !== 'measured' ? `, ${r.basis}` : '')
  const value = r.was !== null ? `${fmt(r.was, m)} → ${fmt(r.value, m)}` : fmt(r.value, m)
  return `${r.short} ${value}${ci}${n}${split}`
}

function linksText (e) {
  return e.links.map(l => md(l.label, l.url)).join(' · ')
}

/** The parent issue's status section, markers included, for `gh-work.mjs body`. */
export function statusMarkdown (v) {
  const lines = [STATUS_START, '## Status', '']
  const phase = v.phase[0].toUpperCase() + v.phase.slice(1)
  const where = [md('Dashboard', v.dashboard), md('ledger', v.ledger), v.plan ? md('settings and criteria', v.plan) : null].filter(l => l && l.includes('](')).join(' · ')
  lines.push(`**${phase}.** ${v.counts.decided} experiments decided, ${v.counts.kept} kept. Updated ${v.updated}.${where ? ' ' + where + '.' : ''}`, '')
  if (v.verdict) lines.push(v.verdict, '')
  lines.push('| Metric | Baseline | Now | Target | Floor | |', '|---|---|---|---|---|---|')
  for (const m of v.metrics) {
    const basis = m.current && m.current.basis !== 'measured' ? `, ${m.current.basis}` : ''
    const now = m.current ? `${fmt(m.current.value, m)} (${m.current.id}${basis})` : '–'
    const hold = m.holdout ? `<br>${m.holdout.split}: ${fmt(m.holdout.value, m)} (${m.holdout.id})` : ''
    const role = m.role === 'guard' ? ' (guard)' : ''
    lines.push(`| ${cell(m.name)}${role} | ${m.baseline ? fmt(m.baseline.value, m) : '–'} | ${now}${hold} | ${fmt(m.target, m)} | ${typeof m.floor === 'number' ? fmt(m.floor, m) : '–'} | ${STANDING[m.standing]} |`)
  }
  lines.push('')
  const running = v.experiments.filter(e => e.status === 'running')
  const next = v.experiments.filter(e => e.status === 'backlog')
  const bullets = []
  if (running.length) bullets.push(`- ⏳ **Running:** ${running.map(e => `${e.id} ${e.title}${e.links.length ? ` (${linksText(e)})` : ''}`).join('; ')}`)
  if (next.length) bullets.push(`- **Next up:** ${next.slice(0, 3).map(e => `${e.id} ${e.title}`).join('; ')}${next.length > 3 ? `; ${next.length - 3} more in the backlog` : ''}`)
  for (const w of v.waiting) bullets.push(`- ❓ **Waiting on ${w.who}:** ${w.what}${w.link ? ` ([where](${w.link}))` : ''}`)
  const steps = v.human.filter(h => h.status !== 'done')
  if (steps.length) bullets.push(`- 🙋 **Needs a person:** ${steps.map(h => h.link ? md(h.what, h.link) : h.what).join('; ')}`)
  if (v.unmeasured.length) bullets.push(`- 📏 **Not measured yet:** ${v.unmeasured.map(u => `${u.what}${u.waiting ? ` (waiting on ${u.waiting})` : ''}`).join('; ')}`)
  if (v.resources.length) bullets.push(`- 🔒 **Held:** ${v.resources.map(r => `${r.name}: ${r.holder}${r.since ? ` since ${r.since}` : ''}`).join('; ')}`)
  lines.push(...bullets)
  if (bullets.length) lines.push('')

  const decided = v.experiments.filter(e => DECIDED.has(e.status)).reverse()
  const row = e => `| ${e.id} | ${ICON[e.status]} ${cell(e.title)} | ${cell(e.results.map(resultText).join('; '))} | ${cell(e.decision)} | ${linksText(e)} |`
  const header = ['| | Experiment | Result | Decision | Links |', '|---|---|---|---|---|']
  if (decided.length) {
    lines.push('### Latest results', '', ...header, ...decided.slice(0, 5).map(row), '')
    if (decided.length > 5) lines.push(`<details><summary><b>${decided.length - 5} earlier experiments</b></summary>`, '', ...header, ...decided.slice(5).map(row), '', '</details>', '')
  }
  lines.push(STATUS_END)
  return lines.join('\n') + '\n'
}

/** LOG.md: the experiment log, newest first, generated from the ledger. */
export function logMarkdown (v) {
  const lines = [`# ${v.title}: experiment log`, '', 'Generated from `ledger/`: edit the ledger, not this file.', '']
  if (v.revisions.length) {
    lines.push('## Revisions to the criteria', '')
    for (const r of [...v.revisions].reverse()) lines.push(`- **Rev ${r.rev}** (${r.date}${r.who ? ', ' + r.who : ''}): ${r.what} Why: ${r.why}${r.link ? ` ([where](${r.link}))` : ''}`)
    lines.push('')
  }
  if (v.corrections.length) {
    lines.push('## Corrections to reported figures', '')
    for (const c of [...v.corrections].reverse()) lines.push(`- **${c.date}**, ${c.what}: ${c.old} → ${c.new}. Why: ${c.why}${c.where ? ` (${c.where})` : ''}`)
    lines.push('')
  }
  for (const e of v.experiments.filter(x => DECIDED.has(x.status)).reverse()) {
    lines.push(`## ${e.decided}: ${e.id} ${e.title} (${e.status})`, '')
    if (e.hypothesis) lines.push(`- **Tried:** ${e.hypothesis}`)
    for (const r of e.results) lines.push(`- ${resultText(r)}${r.gain !== null && !r.holdout ? (r.beyondNoise ? '' : ' (within the noise band)') : ''}`)
    lines.push(`- **Decision:** ${e.decision}`)
    if (e.links.length) lines.push(`- ${linksText(e)}`)
    lines.push('')
  }
  return lines.join('\n')
}

/** The dashboard page: the template with the view embedded. */
export function renderHtml (template, v) {
  if (!DATA.test(template)) throw new Error('the template has no /*DATA:climb*/ … /*END:climb*/ block')
  // `<` escaped so text in the ledger can never close the script element.
  const json = JSON.stringify(v).replace(/</g, '\\u003c')
  const title = String(v.title).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  return template.replace(DATA, () => `/*DATA:climb*/${json}/*END:climb*/`).replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
}

/** Write LOG.md, build/status.md and build/index.html, and say what to publish. */
export function build (dir, template = TEMPLATE) {
  const { climb, experiments } = load(dir)
  const found = problems(climb, experiments)
  if (found.length) return { ok: false, problems: found }
  const v = view(climb, experiments)
  const out = join(dir, 'build')
  mkdirSync(out, { recursive: true })
  if (!existsSync(join(dir, '.gitignore'))) writeFileSync(join(dir, '.gitignore'), 'build/\n')
  writeFileSync(join(dir, 'LOG.md'), logMarkdown(v))
  writeFileSync(join(out, 'status.md'), statusMarkdown(v))
  writeFileSync(join(out, 'index.html'), renderHtml(readFileSync(template, 'utf8'), v))
  // Report files go up beside the page, at the path the page links to.
  const files = Object.fromEntries((climb.reports ?? []).filter(r => r.file).map(r => [r.file, relative(process.cwd(), resolve(dir, r.file))]))
  return { ok: true, headline: v.headline, page: join(out, 'index.html'), status: join(out, 'status.md'), log: join(dir, 'LOG.md'), files, counts: v.counts }
}

function main () {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { dir: { type: 'string' }, template: { type: 'string' } } })
  const command = positionals[0]
  if (!values.dir || !['check', 'build'].includes(command)) {
    process.stderr.write('usage: climb-report.mjs check|build --dir <climb folder>\n')
    process.exit(2)
  }
  try {
    if (command === 'check') {
      const { climb, experiments } = load(values.dir)
      const found = problems(climb, experiments)
      process.stdout.write(JSON.stringify({ ok: !found.length, problems: found }) + '\n')
      process.exit(found.length ? 1 : 0)
    }
    const result = build(values.dir, values.template ?? TEMPLATE)
    process.stdout.write(JSON.stringify(result) + '\n')
    process.exit(result.ok ? 0 : 1)
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, problems: [String(error.message).split('\n')[0]] }) + '\n')
    process.exit(1)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
