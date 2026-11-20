// Builds one self-contained, live-refreshing report.html from <dir>/rounds.json and the
// <dir>/round<N>/<shot>.png screenshots. No dependencies; Node 18+.
//
//   node build-report.mjs <review-dir>                 # writes <review-dir>/report.html (refreshes every 30 s)
//   node build-report.mjs <review-dir> --share         # writes report-share.html without the refresh tag
//   node build-report.mjs <review-dir> --out x.html --refresh 10
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !['--out', '--refresh'].includes(args[i - 1]));
const dir = resolve(positional[0] || '.');
const share = flag('--share');
const refresh = share ? 0 : Number(opt('--refresh', '30'));
const outArg = opt('--out', share ? 'report-share.html' : 'report.html');
const outPath = isAbsolute(outArg) ? outArg : join(dir, outArg);

const data = JSON.parse(readFileSync(join(dir, 'rounds.json'), 'utf8'));
const J = data.judges || [];
const C = data.criteria || [];
const SHOTS = data.shots || [
  { id: 'desktop-fold', label: 'Desktop fold' },
  { id: 'desktop-full', label: 'Full page' },
  { id: 'narrow', label: 'Narrow' },
];
const PALETTE = ['#b11f4b', '#0078d4', '#d97706', '#16a34a', '#7c3aed', '#0891b2', '#be185d'];
const color = (j, i) => j.color || PALETTE[i % PALETTE.length];
const AVG_COLOR = 'var(--text)';
const totalWeight = C.reduce((a, [, , w]) => a + w, 0) || 100;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt = (x, d = 1) => (x === null || x === undefined ? '—' : x.toFixed(d));
const img = (round, name) => {
  const p = join(dir, `round${round}`, `${name}.png`);
  return existsSync(p) ? `data:image/png;base64,${readFileSync(p).toString('base64')}` : null;
};

// Recompute each judge's weighted overall from the criterion scores; reviewers' arithmetic is not trusted.
const warnings = [];
const overallOf = (r, j) => {
  const s = r.scores && r.scores[j.id];
  if (!s) return null;
  const complete = Array.isArray(s.c) && s.c.length === C.length && s.c.every((v) => typeof v === 'number');
  if (!complete) return typeof s.overall === 'number' ? s.overall : null;
  const computed = s.c.reduce((a, v, i) => a + v * C[i][2], 0) / totalWeight;
  if (typeof s.overall === 'number' && Math.abs(s.overall - computed) > 0.0501) {
    warnings.push(`round ${r.round} ${j.id}: reported ${s.overall} but criteria give ${computed.toFixed(2)}; using computed`);
  }
  return computed;
};

const rounds = data.rounds.map((r) => {
  const overall = J.map((j) => overallOf(r, j));
  const scored = overall.filter((x) => x !== null);
  return { ...r, changes: r.changes || [], feedback: r.feedback || [], overall, mean: avg(scored), pending: scored.length < J.length };
});
const scoredRounds = rounds.filter((r) => r.mean !== null);
const first = scoredRounds[0];
const last = scoredRounds[scoredRounds.length - 1];
const best = scoredRounds.reduce((a, b) => (b.mean > a.mean ? b : a), first);

function trend() {
  const W = 640, H = 260, L = 40, R = 120, T = 16, B = 34;
  const n = Math.max(rounds.length, 4);
  const x = (i) => L + (i * (W - L - R)) / (n - 1);
  const y = (v) => T + (1 - v / 10) * (H - T - B);
  let g = '';
  for (let v = 0; v <= 10; v += 2) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`;
  for (let i = 0; i < n; i++) g += `<text x="${x(i)}" y="${H - 12}" class="ax" text-anchor="middle">Round ${i}</text>`;
  const series = [
    ...J.map((j, ji) => ({ avg: false, name: j.name, color: color(j, ji), vals: rounds.map((r) => r.overall[ji]) })),
    { avg: true, name: 'Panel average', color: AVG_COLOR, vals: rounds.map((r) => (r.pending ? null : r.mean)) },
  ];
  const labels = [];
  for (const s of series) {
    const pts = s.vals.map((v, i) => (v === null ? null : [x(i), y(v), v])).filter(Boolean);
    if (!pts.length) continue;
    g += `<polyline points="${pts.map((p) => `${p[0]},${p[1]}`).join(' ')}" class="line${s.avg ? ' avg' : ''}" style="stroke:${s.color}"/>`;
    for (const p of pts) g += `<circle cx="${p[0]}" cy="${p[1]}" r="${s.avg ? 5 : 4}" style="fill:${s.color}"><title>${esc(s.name)}: ${p[2].toFixed(2)}</title></circle>`;
    const lp = pts[pts.length - 1];
    labels.push({ x: lp[0] + 10, y: lp[1] + 4, color: s.color, text: `${s.avg ? 'Avg' : s.name.split(' ')[0]} ${lp[2].toFixed(s.avg ? 2 : 1)}` });
  }
  labels.sort((a, b) => a.x - b.x || a.y - b.y);
  for (let i = 1; i < labels.length; i++) {
    const p = labels[i - 1], c = labels[i];
    if (Math.abs(c.x - p.x) < 60 && c.y - p.y < 15) c.y = p.y + 15;
  }
  for (const l of labels) g += `<text x="${l.x}" y="${l.y}" class="lbl" style="fill:${l.color}">${esc(l.text)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="Overall score per round by judge">${g}</svg>`;
}

const heatCell = (v, d) => `<td class="num heat" data-v="${typeof v === 'number' ? Math.round(v) : ''}">${typeof v === 'number' ? fmt(v, d) : '—'}</td>`;

function heat() {
  const head = `<tr><th>Criterion</th><th class="num">Weight</th>${rounds.map((r) => `<th class="num">R${r.round}</th>`).join('')}<th class="num">Δ</th></tr>`;
  const rows = C.map(([id, name, w], ci) => {
    const vals = rounds.map((r) => avg(J.map((j) => r.scores && r.scores[j.id] && r.scores[j.id].c && r.scores[j.id].c[ci]).filter((v) => typeof v === 'number')));
    const known = vals.filter((v) => v !== null);
    const d = known.length > 1 ? known[known.length - 1] - known[0] : null;
    return `<tr><td><b>${esc(id)}</b> ${esc(name)}</td><td class="num">${w}</td>${vals.map((v) => heatCell(v, 1)).join('')}<td class="num ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d === null ? '—' : (d > 0 ? '+' : '') + d.toFixed(1)}</td></tr>`;
  });
  return `<table class="heatmap">${head}${rows.join('')}</table>`;
}

const shot = (r, s) => {
  const src = img(r.round, s.id);
  const label = esc(s.label);
  return src
    ? `<button class="shot" data-full="${esc(s.id)}-${r.round}" aria-label="Open ${label}, round ${r.round}"><img src="${src}" alt="${label}, round ${r.round}" loading="lazy"><span>${label}</span></button>`
    : `<div class="shot missing">${label}<br>not captured</div>`;
};

const genRows = rounds.map((r, idx) => {
  const cells = J.map((j, ji) => `<td class="score">${r.overall[ji] === null ? '<span class="pending">pending</span>' : `<span class="big">${r.overall[ji].toFixed(1)}</span>`}</td>`).join('');
  const prev = rounds[idx - 1];
  const delta = prev && prev.mean !== null && !prev.pending && r.mean !== null && !r.pending ? r.mean - prev.mean : null;
  const avgCell = r.mean === null
    ? '<span class="pending">pending</span>'
    : `<span class="big">${r.mean.toFixed(2)}</span>${r.pending ? '<div class="pending">partial</div>' : ''}${delta === null ? '' : `<div class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲ +' : '▼ '}${delta.toFixed(2)}</div>`}`;
  const list = (xs, empty) => (xs.length ? `<ul>${xs.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : `<p class="pending">${empty}</p>`);
  return `<tr id="r${r.round}">
    <td class="gen"><div class="gen-n">Round ${r.round}</div><div class="gen-t">${esc(r.title)}</div><code>${esc(r.commit || '')}</code></td>
    <td><div class="shots">${SHOTS.map((s) => shot(r, s)).join('')}</div></td>
    ${cells}
    <td class="score avgc">${avgCell}</td>
  </tr>
  <tr class="noterow"><td></td><td colspan="${J.length + 2}" class="notes"><div class="notecols">
    <div><h4>Changes in this generation</h4>${list(r.changes, r.round === 0 ? 'Baseline (unmodified)' : 'Not recorded')}</div>
    <div><h4>Panel feedback → next round</h4>${list(r.feedback, 'Awaiting reviews')}</div></div></td></tr>`;
}).join('');

const judgeTables = J.map((j, ji) => `<div><h3><span class="sw" style="background:${color(j, ji)}"></span>${esc(j.name)} <code>${esc(j.model || '')}</code></h3><table>
<tr><th>Criterion</th>${rounds.map((r) => `<th class="num">R${r.round}</th>`).join('')}</tr>
${C.map(([id, name], ci) => `<tr><td><b>${esc(id)}</b> ${esc(name)}</td>${rounds.map((r) => heatCell(r.scores && r.scores[j.id] && r.scores[j.id].c ? r.scores[j.id].c[ci] : null, 0)).join('')}</tr>`).join('')}
<tr><td><b>Weighted overall</b></td>${rounds.map((r) => `<td class="num"><b>${fmt(r.overall[ji])}</b></td>`).join('')}</tr></table></div>`).join('');

const fullImgs = Object.fromEntries(rounds.flatMap((r) => SHOTS.map((s) => [`${s.id}-${r.round}`, img(r.round, s.id)])).filter(([, v]) => v));
const title = data.title || 'Design panel review · hill-climb report';
const kpi = (l, v, cls = '') => `<div class="kpi"><div class="l">${l}</div><div class="v ${cls}">${v}</div></div>`;
const gain = last && first && last !== first ? last.mean - first.mean : null;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">${refresh > 0 ? `<meta http-equiv="refresh" content="${refresh}">` : ''}<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { color-scheme: light dark; --bg:#f7f4ef; --surface:#fff; --soft:#f5f5f5; --border:#dedede; --strong:#919191; --text:#242424; --muted:#5c5c5c; --accent:#b11f4b; --ok:#16a34a; --bad:#dc2626; --warn:#f59e0b; --overlay:rgba(255,255,255,.85); }
@media (prefers-color-scheme: dark) { :root { --bg:#2b2a29; --surface:#1f1f1f; --soft:#262626; --border:#474747; --strong:#5f5f5f; --text:#dedede; --muted:#a0a0a0; --accent:#fd8ea1; --ok:#4ade80; --bad:#f87171; --warn:#fbbf24; --overlay:rgba(20,20,20,.88); } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 "Segoe UI", Aptos, -apple-system, BlinkMacSystemFont, sans-serif; }
code { font-family: Consolas, Menlo, monospace; font-size: 12px; color: var(--muted); }
main { max-width: 1400px; margin: 0 auto; padding: 24px; display: grid; gap: 20px; }
h1 { margin: 0; font-size: 24px; } h2 { margin: 0 0 12px; font-size: 17px; }
.sub { color: var(--muted); margin: 4px 0 0; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 20px; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
.kpi { background: var(--soft); border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; }
.kpi .v { font-size: 28px; font-weight: 700; } .kpi .l { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.kpi .v.accent { color: var(--accent); }
.two { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 20px; }
@media (max-width: 1000px) { .two { grid-template-columns: 1fr; } }
.trend { width: 100%; height: auto; }
.trend .grid { stroke: var(--border); } .trend .ax { fill: var(--muted); font-size: 11px; }
.trend .line { fill: none; stroke-width: 2.5; } .trend .line.avg { stroke-width: 3.5; stroke-dasharray: 6 4; }
.trend .lbl { font-size: 12px; font-weight: 600; }
.legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
.sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
table { border-collapse: collapse; width: 100%; }
th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; padding: 8px; border-bottom: 1px solid var(--strong); }
td { padding: 10px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.heat[data-v="8"], .heat[data-v="9"], .heat[data-v="10"] { background: color-mix(in srgb, var(--ok) 30%, transparent); }
.heat[data-v="6"], .heat[data-v="7"] { background: color-mix(in srgb, var(--ok) 14%, transparent); }
.heat[data-v="5"] { background: color-mix(in srgb, var(--warn) 18%, transparent); }
.heat[data-v="1"], .heat[data-v="2"], .heat[data-v="3"], .heat[data-v="4"] { background: color-mix(in srgb, var(--bad) 18%, transparent); }
.up { color: var(--ok); font-weight: 600; } .down { color: var(--bad); font-weight: 600; }
.gens .gen { width: 150px; } .gen-n { font-weight: 700; font-size: 16px; } .gen-t { color: var(--muted); margin-bottom: 4px; }
.gens tr:not(.noterow) td { border-bottom: none; }
.shots { display: flex; gap: 12px; flex-wrap: wrap; }
.shot { all: unset; cursor: pointer; display: grid; gap: 4px; width: 220px; font-size: 11px; color: var(--muted); text-align: center; }
.shot img { width: 220px; height: 240px; object-fit: cover; object-position: top; border-radius: 10px; border: 1px solid var(--border); }
.shot:hover img, .shot:focus-visible img { border-color: var(--accent); }
.shot:focus-visible { outline: 2px solid var(--accent); border-radius: 10px; }
.shot.missing { display: grid; place-items: center; height: 240px; border: 1px dashed var(--border); border-radius: 10px; }
.score { text-align: center; width: 100px; vertical-align: middle; } .big { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
.avgc .big { color: var(--accent); }
.pending { color: var(--muted); font-style: italic; font-size: 12px; }
.notecols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.notes h4 { margin: 0; color: var(--muted); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; }
.notes ul { margin: 6px 0 0; padding-left: 18px; } .notes li { margin: 2px 0; font-size: 13px; }
th.jh { text-align: center; }
.judge-tables { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 16px; }
.judge-tables h3 { margin: 0 0 6px; font-size: 14px; }
dialog { border: 1px solid var(--border); border-radius: 16px; background: var(--surface); color: var(--text); padding: 12px; max-width: 95vw; max-height: 95vh; }
dialog::backdrop { background: var(--overlay); }
dialog img { max-width: 92vw; display: block; }
dialog .bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
dialog button { background: var(--accent); color: #fff; border: none; border-radius: 10px; padding: 6px 14px; cursor: pointer; font: inherit; }
.method { color: var(--muted); font-size: 13px; }
</style></head><body><main>
<header><h1>${esc(title)}</h1>
<p class="sub">${esc(data.subtitle || `Each generation is a commit of the design. A fresh panel of ${J.length} judges (a new session per judge per round) scores it 1–10 against a weighted ${C.length}-criterion rubric from the same screenshots and brief. Their feedback drives the next generation's edits.`)}</p></header>
<section class="kpis">
  ${kpi('Generations', rounds.length)}
  ${kpi('Baseline panel avg', first ? first.mean.toFixed(2) : '—')}
  ${kpi(`Latest scored avg${last && last.pending ? ' (partial)' : ''}`, last ? last.mean.toFixed(2) : '—', 'accent')}
  ${kpi('Gain vs baseline', gain === null ? '—' : `${gain >= 0 ? '+' : ''}${gain.toFixed(2)}`, gain > 0 ? 'up' : gain < 0 ? 'down' : '')}
  ${kpi('Best generation', best ? `R${best.round}` : '—')}
</section>
<section class="two">
  <div class="card"><h2>Overall score by judge</h2>${trend()}
    <div class="legend">${J.map((j, ji) => `<span><span class="sw" style="background:${color(j, ji)}"></span>${esc(j.name)} <code>${esc(j.model || '')}</code></span>`).join('')}<span><span class="sw" style="background:${AVG_COLOR}"></span>Panel average</span></div></div>
  <div class="card"><h2>Panel mean per criterion</h2>${heat()}</div>
</section>
<section class="card"><h2>Generations</h2>
<table class="gens"><thead><tr><th>Generation</th><th>Screenshots (click to enlarge)</th>${J.map((j, ji) => `<th class="jh"><span class="sw" style="background:${color(j, ji)}"></span>${esc(j.name.split(' ')[0])}</th>`).join('')}<th class="jh">Avg</th></tr></thead>
<tbody>${genRows}</tbody></table></section>
<section class="card"><h2>Criterion scores by judge</h2><div class="judge-tables">${judgeTables}</div></section>
<p class="method">Overall = Σ(score × weight) / ${totalWeight}, recomputed from each judge's criterion scores. Weights: ${C.map(([id, , w]) => `${esc(id)} ${w}`).join(', ')}.${data.method ? ` ${esc(data.method)}` : ''} Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC${refresh > 0 ? `; this page reloads every ${refresh} s` : ''}.</p>
</main>
<dialog id="lb"><div class="bar"><strong id="lb-t"></strong><button id="lb-x">Close</button></div><img id="lb-img" alt=""></dialog>
<script>
  const FULL = ${JSON.stringify(fullImgs).replace(/</g, '\\u003c')};
  const lb = document.getElementById('lb');
  document.querySelectorAll('.shot[data-full]').forEach((b) => b.addEventListener('click', () => {
    const label = b.getAttribute('aria-label');
    document.getElementById('lb-img').src = FULL[b.dataset.full];
    document.getElementById('lb-img').alt = label;
    document.getElementById('lb-t').textContent = label.replace(/^Open /, '');
    lb.showModal();
  }));
  document.getElementById('lb-x').addEventListener('click', () => lb.close());
  lb.addEventListener('click', (e) => { if (e.target === lb) lb.close(); });
</script>
</body></html>`;

writeFileSync(outPath, html);
for (const w of warnings) console.warn(`warning: ${w}`);
console.log(`${outPath} written: ${rounds.length} rounds, ${(html.length / 1024 / 1024).toFixed(1)} MB${refresh > 0 ? `, refresh ${refresh}s` : ', no refresh'}`);
