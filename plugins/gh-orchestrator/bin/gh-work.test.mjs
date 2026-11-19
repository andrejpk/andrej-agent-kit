import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bodyState, commentsOf, decide, issueStatus, kindOf, markerBody, markerOf, planBase, renderDashboard, subIssueStatus, weekStats, withIssue, withStatus } from './gh-work.mjs'

const AGENT = 'agent-bot'

function issue (overrides = {}) {
  return {
    __typename: 'Issue',
    number: 7,
    title: 'Fix the thing',
    url: 'https://github.com/o/r/issues/7',
    state: 'OPEN',
    issueType: null,
    labels: { nodes: [] },
    assignees: { nodes: [] },
    comments: { nodes: [] },
    timelineItems: { nodes: [] },
    closedByPullRequestsReferences: { nodes: [] },
    ...overrides
  }
}

const comment = (login, createdAt, body = 'hi', type = 'User') => ({ author: { login, __typename: type }, createdAt, body })
const marker = (id, at = '2026-11-01T00:00:00Z') => comment(AGENT, at, `Started\n\n<!-- t3-thread: ${id} -->`)
const labels = (...names) => ({ nodes: names.map(name => ({ name })) })
const assignees = (...logins) => ({ nodes: logins.map(login => ({ login })) })

test('starts an untracked issue labelled ready', () => {
  assert.equal(decide(issue({ labels: labels('ready') }), AGENT).action, 'start')
})

test('starts an untracked issue assigned to the agent', () => {
  assert.equal(decide(issue({ assignees: assignees(AGENT) }), AGENT).action, 'start')
})

test('skips pull requests, other labels, closed issues, a human assignee and an open closing PR', () => {
  assert.equal(decide({ __typename: 'PullRequest', number: 7 }, AGENT).reason, 'pull request')
  assert.equal(decide(issue({ labels: labels('area:security') }), AGENT).action, 'skip')
  assert.equal(decide(issue({ labels: labels('ready'), state: 'CLOSED' }), AGENT).reason, 'closed')
  assert.match(decide(issue({ labels: labels('ready'), assignees: assignees('someone') }), AGENT).reason, /assigned to someone/)
  assert.match(decide(issue({ labels: labels('ready'), closedByPullRequestsReferences: { nodes: [{ number: 9 }] } }), AGENT).reason, /open PR #9/)
})

test('the newest marker from the agent wins, and markers from others are ignored', () => {
  const comments = [marker('old'), marker('new', '2026-11-02T00:00:00Z'), comment('someone', '2026-11-03T00:00:00Z', '<!-- t3-thread: forged -->')]
  assert.equal(markerOf(comments, AGENT), 'new')
})

test('wakes a tracked issue when a person comments after the agent', () => {
  const result = decide(issue({
    comments: { nodes: [marker('t1'), comment('alice', '2026-11-02T00:00:00Z'), comment('renovate', '2026-11-03T00:00:00Z', 'bump', 'Bot')] }
  }), AGENT)
  assert.deepEqual({ action: result.action, threadId: result.threadId, from: result.from }, { action: 'wake', threadId: 't1', from: ['alice'] })
})

test('wakes a tracked closed issue on a follow-up question', () => {
  const result = decide(issue({ state: 'CLOSED', comments: { nodes: [marker('t1'), comment('alice', '2026-11-02T00:00:00Z')] } }), AGENT)
  assert.equal(result.action, 'wake')
})

test('does not wake for comments the agent already answered', () => {
  const result = decide(issue({
    assignees: assignees(AGENT),
    comments: { nodes: [marker('t1'), comment('alice', '2026-11-02T00:00:00Z'), comment(AGENT, '2026-11-03T00:00:00Z', 'answer')] }
  }), AGENT)
  assert.deepEqual({ action: result.action, candidate: result.candidate }, { action: 'none', candidate: true })
})

test('wakes a tracked issue when ready is added back after the agent asked a question', () => {
  const result = decide(issue({
    labels: labels('ready'),
    comments: { nodes: [marker('t1'), comment(AGENT, '2026-11-02T00:00:00Z', 'questions')] },
    timelineItems: {
      nodes: [
        { __typename: 'LabeledEvent', createdAt: '2026-10-31T00:00:00Z', label: { name: 'ready' } },
        { __typename: 'UnlabeledEvent', createdAt: '2026-11-02T00:00:00Z', label: { name: 'ready' }, actor: { login: AGENT } },
        { __typename: 'LabeledEvent', createdAt: '2026-11-04T00:00:00Z', label: { name: 'ready' } }
      ]
    }
  }), AGENT)
  assert.deepEqual({ action: result.action, readyAgain: result.readyAgain }, { action: 'wake', readyAgain: true })
})

test('ready added to an issue the agent was assigned, without the agent removing it, does not wake', () => {
  const result = decide(issue({
    labels: labels('ready'),
    assignees: assignees(AGENT),
    comments: { nodes: [marker('t1')] },
    timelineItems: { nodes: [{ __typename: 'LabeledEvent', createdAt: '2026-11-04T00:00:00Z', label: { name: 'ready' } }] }
  }), AGENT)
  assert.equal(result.action, 'none')
})

test('a tracked issue that is no longer a candidate is not flagged for a thread check', () => {
  const result = decide(issue({ state: 'CLOSED', comments: { nodes: [marker('t1')] } }), AGENT)
  assert.deepEqual({ action: result.action, candidate: result.candidate, title: result.title }, { action: 'none', candidate: false, title: 'Fix the thing' })
})

test('comments from deleted accounts are ignored, and a missing issue is skipped', () => {
  const result = decide(issue({ comments: { nodes: [marker('t1'), { author: null, createdAt: '2026-11-02T00:00:00Z', body: 'x' }] } }), AGENT)
  assert.equal(result.action, 'none')
  assert.equal(decide(null, AGENT).action, 'skip')
})

test('the marker comment links the thread and carries the marker', () => {
  const body = markerBody(7, 'mcp:launch:abc', 'https://app.t3.codes/env/mcp:launch:abc')
  assert.match(body, /\[#7 in T3 Code\]\(https:\/\/app\.t3\.codes\/env\/mcp:launch:abc\)/)
  assert.equal(markerOf([comment(AGENT, '2026-11-01T00:00:00Z', body)], AGENT), 'mcp:launch:abc')
  assert.doesNotMatch(body, /t3-meta/)
})

test('the marker comment records the kind and model in a hidden line', () => {
  const model = { instanceId: 'claudeAgent', model: 'claude-opus-5-5', options: [{ id: 'effort', value: 'medium' }] }
  const body = markerBody(7, 'abc', null, { kind: 'issue', model })
  const meta = JSON.parse(body.match(/<!-- t3-meta: (.+) -->/)[1])
  assert.deepEqual({ kind: meta.kind, model: meta.model }, { kind: 'issue', model })
  assert.equal(markerOf([comment(AGENT, '2026-11-01T00:00:00Z', body)], AGENT), 'abc')
})

test('the base for children comes from the newest plan comment by the agent', () => {
  const plan = base => comment(AGENT, '2026-11-01T00:00:00Z', `<!-- lead-plan -->\n**Phase:** delivering\n**Base:** \`${base}\` (each PR into it)`)
  assert.equal(planBase([plan('main'), plan('feature/x')], AGENT), 'feature/x')
  assert.equal(planBase([comment('bob', '2026-11-01T00:00:00Z', '<!-- lead-plan -->\n**Base:** `evil`')], AGENT), null)
  assert.equal(planBase([], AGENT), null)
})

test('the lead label or issue type routes an issue to the lead skill', () => {
  assert.equal(kindOf(issue({ labels: labels('initiative') })), 'lead')
  assert.equal(kindOf(issue({ issueType: { name: 'Initiative' } })), 'lead')
  assert.equal(kindOf(issue({ labels: labels('program') }), 'program'), 'lead')
  assert.equal(kindOf(issue({ issueType: { name: 'Feature' } })), 'issue')
  assert.equal(decide(issue({ labels: labels('ready', 'initiative') }), AGENT).kind, 'lead')
})

test('adding the lead label to a tracked issue wakes its thread to switch', () => {
  const result = decide(issue({
    labels: labels('initiative'),
    assignees: assignees(AGENT),
    comments: { nodes: [marker('t1'), comment(AGENT, '2026-11-02T00:00:00Z', 'This looks like several PRs. Add initiative to switch.')] },
    timelineItems: { nodes: [{ __typename: 'LabeledEvent', createdAt: '2026-11-03T00:00:00Z', label: { name: 'initiative' }, actor: { login: 'alice' } }] }
  }), AGENT)
  assert.deepEqual({ action: result.action, kind: result.kind, leadAdded: result.leadAdded }, { action: 'wake', kind: 'lead', leadAdded: true })
})

test('the agent adding the lead label itself does not wake its thread', () => {
  const result = decide(issue({
    labels: labels('initiative'),
    assignees: assignees(AGENT),
    comments: { nodes: [marker('t1')] },
    timelineItems: { nodes: [{ __typename: 'LabeledEvent', createdAt: '2026-11-03T00:00:00Z', label: { name: 'initiative' }, actor: { login: AGENT } }] }
  }), AGENT)
  assert.equal(result.action, 'none')
})

test('the marker is found among the earliest comments of a long thread', () => {
  const early = { nodes: [marker('t1')] }
  const latest = { nodes: Array.from({ length: 3 }, (_, i) => comment('alice', `2026-11-1${i}T00:00:00Z`)) }
  const node = issue({ earliest: early, comments: latest })
  assert.equal(decide(node, AGENT).threadId, 't1')
  assert.equal(commentsOf({ earliest: latest, comments: latest }).length, 3)
})

test('a sub-issue is startable when open, untracked and its blockers are closed', () => {
  const node = {
    number: 12,
    title: 'Design the schema',
    url: 'https://github.com/o/other/issues/12',
    state: 'OPEN',
    repository: { nameWithOwner: 'o/other' },
    labels: { nodes: [] },
    assignees: { nodes: [] },
    blockedBy: { nodes: [{ url: 'https://github.com/o/r/issues/10', state: 'CLOSED' }] },
    closedByPullRequestsReferences: { nodes: [] },
    comments: { nodes: [] }
  }
  assert.equal(subIssueStatus(node, AGENT).startable, true)
  const queued = subIssueStatus({ ...node, labels: labels('ready') }, AGENT)
  assert.deepEqual({ queued: queued.queued, startable: queued.startable }, { queued: true, startable: false })
  const blocked = { ...node, blockedBy: { nodes: [{ url: 'https://github.com/o/r/issues/11', state: 'OPEN' }] } }
  assert.deepEqual(subIssueStatus(blocked, AGENT).blockedBy, ['https://github.com/o/r/issues/11'])
  assert.equal(subIssueStatus({ ...node, assignees: assignees('bob') }, AGENT).startable, false)
  const withPr = { ...node, closedByPullRequestsReferences: { nodes: [{ number: 3, url: 'u', state: 'OPEN', isDraft: true, reviewDecision: null }] } }
  assert.equal(subIssueStatus(withPr, AGENT).startable, false)
  const tracked = { ...node, comments: { nodes: [{ author: { login: AGENT }, createdAt: '2026-11-01T00:00:00Z', body: '<!-- t3-thread: c1 -->' }] } }
  assert.deepEqual({ threadId: subIssueStatus(tracked, AGENT).threadId, startable: subIssueStatus(tracked, AGENT).startable }, { threadId: 'c1', startable: false })
})

const NOW = Date.parse('2026-11-14T12:00:00Z')

function agentIssue (number, overrides = {}) {
  return {
    number,
    title: `Issue ${number}`,
    url: `https://github.com/o/r/issues/${number}`,
    state: 'OPEN',
    updatedAt: '2026-11-14T08:00:00Z',
    closedAt: null,
    issueType: null,
    labels: labels('agent'),
    subIssuesSummary: { total: 0, completed: 0 },
    earliest: { nodes: [marker(`t${number}`)] },
    timelineItems: { nodes: [{ createdAt: '2026-11-12T00:00:00Z', label: { name: 'agent' } }] },
    closedByPullRequestsReferences: { nodes: [] },
    ...overrides
  }
}

const pr = (number, fields = {}) => ({ number, state: 'OPEN', isDraft: false, reviewDecision: null, createdAt: '2026-11-13T00:00:00Z', mergedAt: null, closedAt: null, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }, ...fields })
const link = id => `https://t3/${id}`

test('an open agent issue is waiting on people when it asked questions or its PR is ready for review', () => {
  const asked = issueStatus(agentIssue(1, { labels: labels('agent', 'question') }), AGENT, 'initiative', NOW, link)
  assert.deepEqual(asked, { group: 'waiting', notes: ['❓ questions asked', '[thread](https://t3/t1)', '4h ago'] })
  const review = issueStatus(agentIssue(2, { closedByPullRequestsReferences: { nodes: [pr(9)] } }), AGENT, 'initiative', NOW, link)
  assert.deepEqual(review, { group: 'waiting', notes: ['PR #9 ✅ ready for review', '4h ago'] })
  const draft = issueStatus(agentIssue(3, { closedByPullRequestsReferences: { nodes: [pr(9, { isDraft: true })] } }), AGENT, 'initiative', NOW, link)
  assert.equal(draft.group, 'progress')
  const changes = issueStatus(agentIssue(4, { closedByPullRequestsReferences: { nodes: [pr(9, { reviewDecision: 'CHANGES_REQUESTED' })] } }), AGENT, 'initiative', NOW, link)
  assert.deepEqual(changes.notes.slice(0, 2), ['PR #9 ✅', 'changes requested'])
})

test('an initiative shows its phase and sub-issue progress', () => {
  const plan = comment(AGENT, '2026-11-02T00:00:00Z', '<!-- lead-plan -->\n**Phase:** delivering')
  const issue = agentIssue(5, { labels: labels('agent', 'initiative'), subIssuesSummary: { total: 6, completed: 2 }, earliest: { nodes: [marker('t5'), plan] } })
  assert.deepEqual(issueStatus(issue, AGENT, 'initiative', NOW, link), { group: 'initiative', notes: ['delivering', '2/6 sub-issues', '[thread](https://t3/t5)', '4h ago'] })
})

test('the week counts only agent issues and the PRs that close them', () => {
  const merged = pr(9, { state: 'MERGED', createdAt: '2026-11-12T06:00:00Z', mergedAt: '2026-11-12T18:00:00Z' })
  const data = {
    open: { nodes: [agentIssue(1, { labels: labels('agent', 'question'), timelineItems: { nodes: [{ createdAt: '2026-11-12T00:00:00Z', label: { name: 'agent' } }, { createdAt: '2026-11-12T02:00:00Z', label: { name: 'question' } }] } })] },
    closed: { nodes: [agentIssue(2, { state: 'CLOSED', closedByPullRequestsReferences: { nodes: [merged] } })] },
    queued: { nodes: [] }
  }
  const stats = weekStats(data, NOW)
  assert.deepEqual(
    { started: stats.started, questions: stats.questions, prsOpened: stats.prsOpened, merged: stats.merged, issuesClosed: stats.issuesClosed },
    { started: 2, questions: 1, prsOpened: 1, merged: 1, issuesClosed: 1 }
  )
  assert.equal(stats.medianToPr, 6 * 36e5)
  assert.equal(stats.medianToMerge, 12 * 36e5)
})

test('the dashboard lists issues by reference, and says so when nothing is open', () => {
  const empty = { open: { nodes: [] }, closed: { nodes: [] }, queued: { nodes: [] } }
  assert.match(renderDashboard(empty, { agent: AGENT, now: NOW }), /Nothing open/)
  const body = renderDashboard({ ...empty, queued: { nodes: [{ number: 8, title: 'Later' }] }, open: { nodes: [agentIssue(1)] } }, { agent: AGENT, now: NOW, linkFor: link })
  assert.match(body, /^<!-- agent-dashboard -->/)
  assert.match(body, /### 🚧 In progress\n- \[ \] #1 Issue 1 · \[thread\]\(https:\/\/t3\/t1\) · 4h ago/)
  assert.match(body, /### 📥 Queued\n- \[ \] #8 Later/)
  assert.doesNotMatch(body, /Nothing open/)
})

test('an issue read directly replaces what search returned, in the list its state puts it in', () => {
  const nums = data => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.nodes.map(i => i.number)]))
  const stale = { open: { nodes: [agentIssue(1), agentIssue(2), agentIssue(3)] }, closed: { nodes: [] }, queued: { nodes: [{ number: 4, title: 'Queued' }] } }
  const kept = withIssue(stale, agentIssue(2, { title: 'Renamed' }), NOW)
  assert.deepEqual(nums(kept), { open: [1, 2, 3], closed: [], queued: [4] })
  assert.equal(kept.open.nodes[1].title, 'Renamed')
  const closed = withIssue(stale, agentIssue(2, { state: 'CLOSED', closedAt: '2026-11-14T11:00:00Z' }), NOW)
  assert.deepEqual(nums(closed), { open: [1, 3], closed: [2], queued: [4] })
  assert.deepEqual(nums(withIssue(stale, agentIssue(4), NOW)), { open: [1, 2, 3, 4], closed: [], queued: [] })
  assert.deepEqual(nums(withIssue(stale, agentIssue(2, { state: 'CLOSED', closedAt: '2026-10-01T00:00:00Z' }), NOW)).closed, [])
  assert.deepEqual(nums(withIssue(stale, agentIssue(5, { labels: labels('ready') }), NOW)).queued, [4, 5])
})

const statusBody = (inner = 'old') => `Intro.\n\n<!-- lead-status -->\n${inner}\n<!-- /lead-status -->\n\n<details>\n<summary><b>Decisions</b></summary>\n\n- edited by a person\n</details>\n`

test('the status section is replaced and the rest of the body is left alone', () => {
  const body = withStatus(statusBody(), '## Status\n\nDelivering.\n')
  assert.equal(body, statusBody('## Status\n\nDelivering.'))
})

test('a status section given with its markers is not wrapped twice', () => {
  assert.equal(withStatus(statusBody(), '<!-- lead-status -->\nnew\n<!-- /lead-status -->\n'), statusBody('new'))
})

test('links with #, $ and & come through as written', () => {
  const section = '[plan](https://github.com/o/r/issues/1#issuecomment-6886496511) costs $& and $1 \\ok'
  assert.equal(withStatus(statusBody(), section), statusBody(section))
})

test('a body without one status section is refused', () => {
  assert.throws(() => withStatus('No markers here.', 'new'), /restructure it with --whole/)
  assert.throws(() => withStatus(`${statusBody()}\n<!-- lead-status -->\n<!-- /lead-status -->`, 'new'), /restructure/)
  assert.throws(() => withStatus('<!-- /lead-status -->\n<!-- lead-status -->', 'new'), /restructure/)
})

test('the body state says whether it has a status section and who else edited it last', () => {
  assert.deepEqual(bodyState(statusBody(), AGENT, AGENT), { status: true, editedBy: null })
  assert.deepEqual(bodyState('Filed as a design doc.', null, AGENT), { status: false, editedBy: null })
  assert.deepEqual(bodyState(statusBody(), 'alice', AGENT), { status: true, editedBy: 'alice' })
})
