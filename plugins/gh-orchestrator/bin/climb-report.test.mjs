import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, cpSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { breakdownView, build, fmt, gain, headline, load, logMarkdown, ordered, problems, renderHtml, standing, statusMarkdown, view } from './climb-report.mjs'

const EXAMPLE = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'lead-hill-climb', 'example')
const NOW = new Date('2026-11-19T12:00:00Z')

const metric = (over = {}) => ({ id: 'acc', name: 'Accuracy', short: 'Acc', unit: '%', better: 'higher', target: 90, floor: 80, noise: 1, role: 'primary', how: 'eval', ...over })
const climb = (over = {}) => ({ title: 'Climb', phase: 'climbing', repo: 'o/r', branch: 'climb/1-x', path: 'experiments/1-x', metrics: [metric()], ...over })
const exp = (id, status, over = {}) => ({ id, title: id, status, decided: status === 'kept' || status === 'rejected' || status === 'parked' ? over.decided ?? '2026-11-01' : undefined, decision: 'because 1 → 2', ...over })
const res = (value, over = {}) => ({ value, n: 100, ...over })

test('the example ledger is sound', () => {
  const { climb, experiments } = load(EXAMPLE)
  assert.deepEqual(problems(climb, experiments), [])
})

test('problems name what would make the reports misleading', () => {
  const found = problems(climb({ metrics: [metric({ noise: undefined, how: '' })] }), [
    exp('E1', 'kept', { results: { acc: { value: 3 } }, decision: '' }),
    exp('E1', 'backlog'),
    exp('X', 'won')
  ])
  for (const want of [/no noise band/, /no "how"/, /without a decision/, /has no n/, /duplicate id E1/, /backlog without a priority/, /id must look like E7/, /status must be one of/, /no E0/]) {
    assert.ok(found.some(p => want.test(p)), `missing ${want}: ${found.join('; ')}`)
  }
})

test('experiments run in order: decided by date, then running, then the backlog by priority', () => {
  const list = ordered([
    exp('E4', 'backlog', { priority: 2 }), exp('E3', 'running'), exp('E2', 'kept', { decided: '2026-11-03' }),
    exp('E5', 'backlog', { priority: 1 }), exp('E0', 'kept', { decided: '2026-11-01' }), exp('E1', 'rejected', { decided: '2026-11-02' })
  ])
  assert.deepEqual(list.map(e => e.id), ['E0', 'E1', 'E2', 'E3', 'E5', 'E4'])
})

test('a result is compared with the last kept value before it, and the holdout is never climbed on', () => {
  const v = view(climb(), [
    exp('E0', 'kept', { decided: '2026-11-01', results: { acc: res(70) } }),
    exp('E1', 'rejected', { decided: '2026-11-02', results: { acc: res(70.5) } }),
    exp('E2', 'kept', { decided: '2026-11-03', results: { acc: res(75) } }),
    exp('E3', 'kept', { decided: '2026-11-04', results: { acc: res(72, { split: 'holdout' }) } })
  ], NOW)
  const byId = Object.fromEntries(v.experiments.map(e => [e.id, e.results[0]]))
  assert.deepEqual([byId.E1.was, byId.E1.gain, byId.E1.beyondNoise], [70, 0.5, false])
  assert.deepEqual([byId.E2.was, byId.E2.gain, byId.E2.beyondNoise], [70, 5, true])
  assert.equal(byId.E3.holdout, true)
  assert.equal(byId.E3.was, null)
  const m = v.metrics[0]
  assert.deepEqual([m.current.id, m.current.value, m.holdout.id, m.baseline.value, m.standing], ['E2', 75, 'E3', 70, 'below'])
})

test('lower-is-better metrics gain when they fall, and standing reads target and floor', () => {
  const lat = metric({ better: 'lower', target: 100, floor: 200 })
  assert.equal(gain(lat, 300, 250), 50)
  assert.equal(standing(lat, 90), 'target')
  assert.equal(standing(lat, 150), 'floor')
  assert.equal(standing(lat, 250), 'below')
  assert.equal(standing(lat, undefined), 'none')
})

test('numbers show with their unit and a sensible precision', () => {
  assert.equal(fmt(1840, { unit: 'ms' }), '1,840 ms')
  assert.equal(fmt(96.14, { unit: '%' }), '96.1 %')
  assert.equal(fmt(0.8123), '0.81')
  assert.equal(fmt(0.8123, { decimals: 3 }), '0.812')
  assert.equal(fmt(null), '–')
})

test('the headline names the primary metric, where it is and the target', () => {
  const { climb, experiments } = load(EXAMPLE)
  assert.equal(headline(view(climb, experiments, NOW).metrics), 'Time to interactive, p75 1,840 ms (E5) → target 1,500 ms')
})

test('the status section carries the markers, the scoreboard and links back to every experiment', () => {
  const { climb, experiments } = load(EXAMPLE)
  const md = statusMarkdown(view(climb, experiments, NOW))
  assert.match(md, /^<!-- lead-status -->\n## Status/)
  assert.match(md, /<!-- \/lead-status -->\n$/)
  assert.match(md, /\| Time to interactive, p75 \| 2,410 ms \| 1,840 ms \(E5\)<br>holdout: 1,905 ms \(E12\) \| 1,500 ms \| 2,000 ms \| ➖ above floor \|/)
  assert.match(md, /\*\*Next up:\*\* E9 Islands/)
  assert.match(md, /\[branch\]\(https:\/\/github\.com\/example\/shop\/tree\/climb\/42-checkout-tti\/e6-islands\)/)
  assert.match(md, /<summary><b>4 earlier experiments<\/b><\/summary>/)
})

test('pipes in ledger text cannot break the issue tables', () => {
  const v = view(climb(), [exp('E0', 'kept', { title: 'a | b', results: { acc: res(70) } })], NOW)
  assert.match(statusMarkdown(v), /a \\\| b/)
})

test('the log is newest first and flags results inside the noise band', () => {
  const { climb, experiments } = load(EXAMPLE)
  const log = logMarkdown(view(climb, experiments, NOW))
  assert.ok(log.indexOf('E7 Replace the date library') < log.indexOf('E0 Baseline'))
  assert.match(log, /TTI p75 1,890 ms → 1,872 ms \[1,825–1,920\], n 180 \(within the noise band\)/)
  assert.match(log, /\*\*Rev 2\*\*/)
})

test('the page embeds the view, renames itself, and ledger text cannot close the script', () => {
  const template = '<title>Hill climb</title><script>const CLIMB = /*DATA:climb*/null/*END:climb*/;</script>'
  const v = view(climb({ title: 'Speed </script> & more' }), [exp('E0', 'kept', { title: '</script><b>', results: { acc: res(70) } })], NOW)
  const html = renderHtml(template, v)
  assert.equal(html.match(/<\/script>/g).length, 1)
  assert.match(html, /<title>Speed &lt;\/script&gt; &amp; more<\/title>/)
  const json = html.match(/\/\*DATA:climb\*\/(.*)\/\*END:climb\*\//)[1]
  assert.equal(JSON.parse(json).experiments[0].title, '</script><b>')
  assert.throws(() => renderHtml('<p>no data block</p>', v), /no \/\*DATA:climb\*\//)
})

test('build writes the log, the status and the page, and refuses a ledger with problems', () => {
  const dir = mkdtempSync(join(tmpdir(), 'climb-'))
  cpSync(EXAMPLE, dir, { recursive: true })
  const result = build(dir)
  assert.equal(result.ok, true)
  assert.equal(result.headline, 'Time to interactive, p75 1,840 ms (E5) → target 1,500 ms')
  for (const file of ['LOG.md', 'build/status.md', 'build/index.html', '.gitignore']) assert.ok(existsSync(join(dir, file)), file)
  assert.ok(Object.keys(result.files).includes('reports/R1-streaming.html'))
  assert.match(readFileSync(join(dir, 'build/index.html'), 'utf8'), /<title>Checkout time to interactive<\/title>/)

  const bad = mkdtempSync(join(tmpdir(), 'climb-'))
  cpSync(EXAMPLE, bad, { recursive: true })
  cpSync(join(bad, 'ledger', 'E9.json'), join(bad, 'ledger', 'E99.json'))
  assert.equal(build(bad).ok, false)
})

test('a breakdown sums its parts per variant, with ranges and baselines, and counts the ideas aimed at each part', () => {
  const b = breakdownView({
    id: 'lat', title: 'Latency', unit: 'ms', variants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    parts: [
      { id: 'x', label: 'X', value: { a: 10, b: 20 }, baseline: { a: 15, b: 30 } },
      { id: 'y', label: 'Y', basis: 'simulated', value: 5, range: { a: [4, 7], b: [4, 8] } }
    ]
  }, [{ id: 'E1', status: 'kept', parts: ['x'] }, { id: 'E2', status: 'backlog', parts: ['x', 'y'] }])
  assert.equal(b.kind, 'stack')
  assert.deepEqual(b.totals.a, { value: 15, lo: 14, hi: 17, baseline: 20 })
  assert.deepEqual(b.totals.b, { value: 25, lo: 24, hi: 28, baseline: 35 })
  const [x, y] = b.parts
  assert.deepEqual([x.tried, x.kept, x.queued, y.queued, y.basis, x.basis], [1, 1, 1, 1, 'simulated', 'measured'])
  assert.equal(x.values.a.share, 10 / 15)
})

test('problems catch a bad basis, a per-variant value missing a variant, and incomplete corrections', () => {
  const found = problems(climb({
    metrics: [metric({ basis: 'guessed' })],
    breakdowns: [{ id: 'lat', kind: 'pie', variants: [{ id: 'a' }, { id: 'b' }], parts: [{ id: 'x', value: { a: 1 }, basis: 'vibes' }] }],
    corrections: [{ date: '2026-11-01', what: 'E1', old: '1' }],
    unmeasured: [{ waiting: 'a device' }]
  }), [exp('E0', 'kept', { results: { acc: res(1, { basis: 'hoped' }) } })])
  for (const want of [/metric acc: basis/, /kind must be one of stack, share/, /part x: basis/, /value has no value for variant b/, /correction 1: no new/, /correction 1: no why/, /unmeasured 1: no what/, /acc basis must be one of/]) {
    assert.ok(found.some(p => want.test(p)), `missing ${want}: ${found.join('; ')}`)
  }
})

test('a result carries how it was obtained, from itself or its metric, into the status and the page', () => {
  const v = view(climb({ metrics: [metric({ basis: 'simulated', against: 'replays' })] }), [exp('E0', 'kept', { results: { acc: res(70) } })], NOW)
  assert.deepEqual([v.metrics[0].current.basis, v.metrics[0].current.against], ['simulated', 'replays'])
  assert.match(statusMarkdown(v), /70 % \(E0, simulated\)/)
})

test('metrics with no result are listed as not measured, after the listed gaps', () => {
  const v = view(climb({ metrics: [metric(), metric({ id: 'lat', name: 'Latency', role: 'secondary' })], unmeasured: [{ what: 'Accuracy on live traffic', metrics: ['acc'], waiting: 'an A/B slot' }] }),
    [exp('E0', 'kept', { results: { acc: res(70) } })], NOW)
  assert.deepEqual(v.unmeasured.map(u => u.what), ['Accuracy on live traffic', 'Latency'])
  assert.match(statusMarkdown(v), /Not measured yet:\*\* Accuracy on live traffic \(waiting on an A\/B slot\); Latency/)
})

test('corrections are logged with the old and new figure, and link to where they were found', () => {
  const { climb, experiments } = load(EXAMPLE)
  const v = view(climb, experiments, NOW)
  assert.match(logMarkdown(v), /## Corrections to reported figures\n\n- \*\*2026-11-07\*\*, E3 TTI p75: 1,850 ms → 1,890 ms\./)
  assert.equal(v.corrections[0].whereUrl, 'https://github.com/example/shop/blob/climb/42-checkout-tti/experiments/42-checkout-tti/log/E0.md')
})
