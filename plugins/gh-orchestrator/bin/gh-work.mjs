#!/usr/bin/env node
// The orchestrator's GitHub reads and writes, so a run reads one line of JSON
// instead of rebuilding gh/jq pipelines.
//   gh-work.mjs check --repo O/R --issue N [--lead L] [--climb C]  what to do about one issue
//   gh-work.mjs sweep --repo O/R [--days 14] [--lead L] [--climb C] every issue that needs starting or waking
//   gh-work.mjs marker --issue N --thread ID [--kind K] [--model JSON]  the marker comment for a new thread
//   gh-work.mjs plan --repo O/R --issue N               an initiative's or climb's plan comment and sub-issues
//   gh-work.mjs plan-comment --repo O/R --issue N --body-file F   create or update the pinned plan comment
//   gh-work.mjs body --repo O/R --issue N --body-file F [--whole]  replace the status section of an issue's body, or (--whole) the body
//   gh-work.mjs sub-issue --parent URL --child URL      add a sub-issue
//   gh-work.mjs blocked-by --issue URL --by URL         record that one issue blocks another
//   gh-work.mjs dashboard --repo O/R [--lead L] [--climb C] [--dry-run]  rewrite the pinned dashboard issue, and post the weekly summary when due
//   gh-work.mjs dashboard --repo O/R --refresh [--issue N] [--lead L] [--climb C]  only rewrite an existing dashboard, reading issue N directly
// The agent account is whoever gh is signed in as. --lead names the label (or
// issue type) that routes an issue to the lead skill; it defaults to initiative.
// --climb names the one that routes it to the hill-climb lead; it defaults to
// hill-climb-lead.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

export const MARKER = /<!-- t3-thread: (\S+) -->/
export const PLAN_MARKER = '<!-- lead-plan -->'
export const STATUS_START = '<!-- lead-status -->'
export const STATUS_END = '<!-- /lead-status -->'
const PLAN_BASE = /\*\*Base:\*\*\s*`([^`]+)`/
const READY = 'ready'
const LEAD = 'initiative'
const CLIMB = 'hill-climb-lead'
const AGENT_LABEL = 'agent'
const QUESTION = 'question'
const DASHBOARD_MARKER = '<!-- agent-dashboard -->'
const WEEKLY_MARKER = '<!-- agent-weekly -->'
const DASHBOARD_TITLE = '🤖 Agent work'
const WEEK = 7 * 864e5

const ISSUE_FIELDS = `
  __typename
  ... on PullRequest { number url }
  ... on Issue {
    number title url state
    issueType { name }
    parent { number url repository { nameWithOwner } }
    labels(first: 50) { nodes { name } }
    assignees(first: 20) { nodes { login } }
    earliest: comments(first: 50) { nodes { author { login __typename } createdAt body } }
    comments(last: 100) { nodes { author { login __typename } createdAt body } }
    timelineItems(last: 100, itemTypes: [LABELED_EVENT, UNLABELED_EVENT]) {
      nodes {
        __typename
        ... on LabeledEvent { createdAt label { name } actor { login } }
        ... on UnlabeledEvent { createdAt label { name } actor { login } }
      }
    }
    closedByPullRequestsReferences(first: 10, includeClosedPrs: false) { nodes { number } }
  }`

const ISSUE_QUERY = `query($owner: String!, $name: String!, $n: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    issueOrPullRequest(number: $n) { ${ISSUE_FIELDS} }
  }
}`

const COMMENTS_QUERY = `query($owner: String!, $name: String!, $n: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    issue(number: $n) {
      earliest: comments(first: 50) { nodes { author { login __typename } createdAt body } }
      comments(last: 100) { nodes { author { login __typename } createdAt body } }
    }
  }
}`

const PLAN_QUERY = `query($owner: String!, $name: String!, $n: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    issue(number: $n) {
      number title url state body
      editor { login }
      earliest: comments(first: 50) { nodes { id databaseId url author { login __typename } createdAt body } }
      comments(last: 100) { nodes { id databaseId url author { login __typename } createdAt body } }
      subIssues(first: 50) {
        nodes {
          number title url state
          repository { nameWithOwner }
          labels(first: 30) { nodes { name } }
          assignees(first: 10) { nodes { login } }
          blockedBy(first: 20) { nodes { url state } }
          closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { nodes { number url state isDraft reviewDecision } }
          earliest: comments(first: 20) { nodes { author { login } createdAt body } }
          comments(last: 30) { nodes { author { login } createdAt body } }
        }
      }
    }
  }
}`

const SEARCH_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) { nodes { ... on Issue { number } } }
}`

function gh (args, input) {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 32 * 1024 * 1024 }))
}

function graphql (query, vars) {
  const args = ['api', 'graphql', '-f', `query=${query}`]
  for (const [key, value] of Object.entries(vars)) args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`)
  return gh(args).data
}

/** The thread an issue's newest marker comment from the agent points at. */
export function markerOf (comments, agent) {
  let threadId = null
  for (const c of comments) {
    if (c.author?.login !== agent) continue
    const match = c.body.match(MARKER)
    if (match) threadId = match[1]
  }
  return threadId
}

/**
 * An issue's comments, oldest first: the earliest page (where the marker and
 * plan comments usually are) and the latest page, without repeats.
 */
export function commentsOf (issue) {
  const seen = new Set()
  return [...(issue.earliest?.nodes ?? []), ...issue.comments.nodes].filter(c => {
    const key = `${c.createdAt} ${c.author?.login} ${c.body.length}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isPerson (author, agent) {
  return Boolean(author) && author.login !== agent && author.__typename !== 'Bot'
}

/** The logins of people who commented after the agent's last comment. */
function newCommenters (comments, agent) {
  const agentLast = comments.filter(c => c.author?.login === agent).at(-1)?.createdAt ?? ''
  const fresh = comments.filter(c => isPerson(c.author, agent) && c.createdAt > agentLast)
  return [...new Set(fresh.map(c => c.author.login))]
}

/** Whether the issue carries a label or issue type of this name. */
function marked (node, name) {
  return node.labels.nodes.some(l => l.name === name) || node.issueType?.name.toLowerCase() === name.toLowerCase()
}

/**
 * `climb` when the issue carries the climb label or issue type, `lead` for the
 * lead label or type, else `issue`. The climb wins when it has both.
 */
export function kindOf (node, lead = LEAD, climb = CLIMB) {
  if (marked(node, climb)) return 'climb'
  return marked(node, lead) ? 'lead' : 'issue'
}

/** The label that routes an issue of this kind to its lead skill. */
function routeLabel (kind, lead, climb) {
  return kind === 'climb' ? climb : kind === 'lead' ? lead : null
}

/**
 * What the orchestrator should do about one issue:
 * - `start`: no thread tracks it, and it's labelled `ready` or assigned to the
 *   agent, nobody else has it, and no open PR closes it;
 * - `wake`: a thread tracks it and a person commented after the agent's last
 *   comment, `ready` was added back after the agent took it off, or the lead
 *   or climb label was added by a person since the agent's last comment
 *   (agreeing to switch); `leadAdded` says which of those it was;
 * - `none` (tracked, nothing new) or `skip` (not for the agent), with a reason.
 * `kind` says which skill the thread runs.
 */
export function decide (node, agent, lead = LEAD, climb = CLIMB) {
  if (!node) return { action: 'skip', reason: 'no such issue' }
  if (node.__typename !== 'Issue') return { n: node.number, url: node.url, action: 'skip', reason: 'pull request' }
  const base = { n: node.number, url: node.url, title: node.title, kind: kindOf(node, lead, climb) }
  const comments = commentsOf(node)
  const threadId = markerOf(comments, agent)

  if (threadId) {
    const from = newCommenters(comments, agent)
    const events = node.timelineItems.nodes
    const open = node.state === 'OPEN'
    const readyAgain = open && node.labels.nodes.some(l => l.name === READY) && readdedAfterAgent(events, agent)
    const agentLast = comments.filter(c => c.author?.login === agent).at(-1)?.createdAt ?? ''
    const label = routeLabel(base.kind, lead, climb)
    const leadAdded = open && Boolean(label) && events.some(e => {
      const byPerson = e.actor?.login !== agent
      return e.__typename === 'LabeledEvent' && e.label?.name === label && byPerson && e.createdAt > agentLast
    })
    if (from.length || readyAgain || leadAdded) return { ...base, action: 'wake', threadId, from, readyAgain, leadAdded }
    return { ...base, action: 'none', reason: 'tracked', threadId, candidate: notCandidate(node, agent) === null }
  }

  const reason = notCandidate(node, agent)
  if (reason) return { ...base, action: 'skip', reason }
  return { ...base, action: 'start' }
}

/** Why an issue isn't for the agent to start, or null when it is. */
function notCandidate (node, agent) {
  if (node.state !== 'OPEN') return 'closed'
  const assignees = node.assignees.nodes.map(a => a.login)
  if (assignees.length && !assignees.includes(agent)) return `assigned to ${assignees.join(', ')}`
  const prs = node.closedByPullRequestsReferences.nodes.map(p => p.number)
  if (prs.length) return `open PR #${prs.join(', #')}`
  if (!assignees.includes(agent) && !node.labels.nodes.some(l => l.name === READY)) return 'not ready or assigned to the agent'
  return null
}

/** `ready` was added after the agent last took it off (when it asked a question). */
function readdedAfterAgent (events, agent) {
  const removed = events.filter(e => e.__typename === 'UnlabeledEvent' && e.label?.name === READY && e.actor?.login === agent).at(-1)
  return Boolean(removed) && events.some(e => e.__typename === 'LabeledEvent' && e.label?.name === READY && e.createdAt > removed.createdAt)
}

function splitRepo (repo) {
  const [owner, name, extra] = repo?.split('/') ?? []
  if (!owner || !name || extra) throw new Error('--repo OWNER/NAME is required')
  return { owner, name }
}

function check (repo, n, lead, climb) {
  const data = graphql(ISSUE_QUERY, { ...splitRepo(repo), n })
  const agent = data.viewer.login
  const node = data.repository.issueOrPullRequest
  const result = { agent, base: data.repository.defaultBranchRef.name, ...decide(node, agent, lead, climb) }
  if (node?.parent) result.parent = parentOf(node.parent)
  return result
}

/** The agent's newest plan comment on an initiative. */
function planCommentOf (comments, agent) {
  return comments.filter(c => c.author?.login === agent && c.body.includes(PLAN_MARKER)).at(-1)
}

/** The branch an initiative's children base on, from the `**Base:**` line of its plan comment. */
export function planBase (comments, agent) {
  return planCommentOf(comments, agent)?.body.match(PLAN_BASE)?.[1] ?? null
}

/** A sub-issue's parent, with the thread leading it and the base its plan names, if any. */
function parentOf (parent) {
  const repo = parent.repository.nameWithOwner
  const result = { repo, n: parent.number, url: parent.url, threadId: null, base: null }
  try {
    const data = graphql(COMMENTS_QUERY, { ...splitRepo(repo), n: parent.number })
    const comments = commentsOf(data.repository.issue)
    result.threadId = markerOf(comments, data.viewer.login)
    result.base = planBase(comments, data.viewer.login)
  } catch (error) {
    result.error = String(error.stderr || error.message).trim().split('\n')[0]
  }
  return result
}

/**
 * Where one sub-issue stands, for the lead. `queued`: labelled ready, waiting for
 * its repo's orchestrator to start a child. `startable`: the lead may label it ready.
 */
export function subIssueStatus (node, agent) {
  const openBlockers = node.blockedBy.nodes.filter(b => b.state === 'OPEN').map(b => b.url)
  const threadId = markerOf(commentsOf(node), agent)
  const prs = node.closedByPullRequestsReferences.nodes.map(p => ({ n: p.number, url: p.url, state: p.state, draft: p.isDraft, review: p.reviewDecision }))
  const others = node.assignees.nodes.map(a => a.login).filter(login => login !== agent)
  const openPr = prs.some(p => p.state === 'OPEN')
  const ready = node.labels.nodes.some(l => l.name === READY)
  return {
    repo: node.repository.nameWithOwner,
    n: node.number,
    title: node.title,
    url: node.url,
    state: node.state,
    threadId,
    blockedBy: openBlockers,
    assignedTo: others,
    prs,
    queued: node.state === 'OPEN' && ready && !threadId,
    startable: node.state === 'OPEN' && !ready && !threadId && openBlockers.length === 0 && others.length === 0 && !openPr
  }
}

function plan (repo, n) {
  const data = graphql(PLAN_QUERY, { ...splitRepo(repo), n })
  const agent = data.viewer.login
  const issue = data.repository.issue
  const comments = commentsOf(issue)
  const planComment = planCommentOf(comments, agent)
  return {
    agent,
    base: data.repository.defaultBranchRef.name,
    n: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    plan: planComment ? { url: planComment.url, body: planComment.body } : null,
    body: bodyState(issue.body, issue.editor?.login, agent),
    from: newCommenters(comments, agent),
    subIssues: issue.subIssues.nodes.map(node => subIssueStatus(node, agent))
  }
}

/** Create or update the agent's plan comment on an issue, and pin it. */
function planComment (repo, n, bodyFile) {
  let body = readFileSync(bodyFile, 'utf8')
  if (!body.includes(PLAN_MARKER)) body = `${PLAN_MARKER}\n${body}`
  const data = graphql(PLAN_QUERY, { ...splitRepo(repo), n })
  const agent = data.viewer.login
  const existing = planCommentOf(commentsOf(data.repository.issue), agent)
  const input = JSON.stringify({ body })
  let result
  if (existing) {
    gh(['api', '--method', 'PATCH', `repos/${repo}/issues/comments/${existing.databaseId}`, '--input', '-'], input)
    result = { url: existing.url, id: existing.id, updated: true }
  } else {
    const created = gh(['api', '--method', 'POST', `repos/${repo}/issues/${n}/comments`, '--input', '-'], input)
    result = { url: created.html_url, id: created.node_id, created: true }
  }
  try {
    graphql('mutation($id: ID!) { pinIssueComment(input: { issueCommentId: $id }) { clientMutationId } }', { id: result.id })
    result.pinned = true
  } catch (error) {
    // Already pinned, or pinning isn't allowed: the comment is still found by its marker.
    result.pinned = false
  }
  return result
}

/**
 * Whether an issue body has its status section yet, and who last edited the body
 * when that wasn't the agent (a person changed it since the agent last wrote it).
 */
export function bodyState (body, editor, agent) {
  return { status: statusRange(body ?? '') !== null, editedBy: editor && editor !== agent ? editor : null }
}

/** Where the status section is in a body, markers included, or null without exactly one pair. */
function statusRange (body) {
  const start = body.indexOf(STATUS_START)
  const end = body.indexOf(STATUS_END)
  if (start === -1 || end < start) return null
  if (body.indexOf(STATUS_START, start + 1) !== -1 || body.indexOf(STATUS_END, end + 1) !== -1) return null
  return { start, end: end + STATUS_END.length }
}

/**
 * The body with its status section replaced by `section`, everything outside
 * the markers left as it was. `section` may carry the markers itself or not.
 * Plain slicing, so `$`, `&`, `#` and backslashes in links come through as written.
 */
export function withStatus (body, section) {
  const range = statusRange(body)
  if (!range) throw new Error(`the body has no single ${STATUS_START} … ${STATUS_END} section: restructure it with --whole first`)
  const inner = section.replaceAll(STATUS_START, '').replaceAll(STATUS_END, '').trim()
  return `${body.slice(0, range.start)}${STATUS_START}\n${inner}\n${STATUS_END}${body.slice(range.end)}`
}

/**
 * Update an issue's body: only its status section, or with `whole` all of it
 * (the first restructure, which must add the section). The current body is
 * saved to a local file first.
 */
function updateBody (repo, n, bodyFile, whole) {
  const { owner, name } = splitRepo(repo)
  const file = readFileSync(bodyFile, 'utf8')
  const current = gh(['api', `repos/${repo}/issues/${n}`]).body ?? ''
  let body
  if (whole) {
    if (!statusRange(file)) throw new Error(`--whole needs one ${STATUS_START} … ${STATUS_END} section in the body file`)
    body = file
  } else {
    body = withStatus(current, file)
  }
  const dir = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'gh-orchestrator', 'issue-bodies')
  mkdirSync(dir, { recursive: true })
  const backup = join(dir, `${owner}-${name}-${n}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`)
  writeFileSync(backup, current)
  const updated = gh(['api', '--method', 'PATCH', `repos/${repo}/issues/${n}`, '--input', '-'], JSON.stringify({ body }))
  return { url: updated.html_url, backup, chars: { before: current.length, after: body.length } }
}

function nodeId (url) {
  const id = graphql('query($url: URI!) { resource(url: $url) { ... on Issue { id } } }', { url }).resource?.id
  if (!id) throw new Error(`not an issue: ${url}`)
  return id
}

function addSubIssue (parentUrl, childUrl) {
  graphql('mutation($p: ID!, $c: ID!) { addSubIssue(input: { issueId: $p, subIssueId: $c }) { clientMutationId } }', { p: nodeId(parentUrl), c: nodeId(childUrl) })
  return { parent: parentUrl, child: childUrl }
}

function addBlockedBy (issueUrl, blockerUrl) {
  graphql('mutation($i: ID!, $b: ID!) { addBlockedBy(input: { issueId: $i, blockingIssueId: $b }) { clientMutationId } }', { i: nodeId(issueUrl), b: nodeId(blockerUrl) })
  return { issue: issueUrl, blockedBy: blockerUrl }
}

function sweep (repo, days, lead, climb) {
  splitRepo(repo)
  const agent = graphql('query { viewer { login } }', {}).viewer.login
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)
  const searches = [
    `repo:${repo} is:issue is:open label:${READY}`,
    `repo:${repo} is:issue is:open assignee:${agent}`,
    `repo:${repo} is:issue commenter:${agent} updated:>=${since}`
  ]
  const numbers = new Set(searches.flatMap(q => graphql(SEARCH_QUERY, { q }).search.nodes.map(i => i.number)))
  const result = { agent, base: null, start: [], wake: [], tracked: [] }
  for (const n of [...numbers].sort((a, b) => a - b)) {
    const one = check(repo, n, lead, climb)
    result.base = one.base
    const entry = { n, title: one.title, url: one.url, kind: one.kind, parent: one.parent }
    if (one.action === 'start') result.start.push(entry)
    if (one.action === 'wake') result.wake.push({ ...entry, threadId: one.threadId, from: one.from, readyAgain: one.readyAgain, leadAdded: one.leadAdded })
    // Candidates a thread tracks: the broker checks the thread still exists.
    if (one.action === 'none' && one.candidate) result.tracked.push({ ...entry, threadId: one.threadId })
  }
  return result
}

const DASHBOARD_ISSUE_FIELDS = `
  ... on Issue {
    number title url state updatedAt closedAt
    issueType { name }
    labels(first: 30) { nodes { name } }
    subIssuesSummary { total completed }
    earliest: comments(first: 20) { nodes { author { login } createdAt body } }
    timelineItems(last: 50, itemTypes: [LABELED_EVENT]) { nodes { ... on LabeledEvent { createdAt label { name } } } }
    closedByPullRequestsReferences(first: 5, includeClosedPrs: true) {
      nodes { number state isDraft reviewDecision createdAt mergedAt closedAt commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }
    }
  }`

const DASHBOARD_QUERY = `query($open: String!, $closed: String!, $queued: String!) {
  open: search(query: $open, type: ISSUE, first: 100) { nodes { ${DASHBOARD_ISSUE_FIELDS} } }
  closed: search(query: $closed, type: ISSUE, first: 100) { nodes { ${DASHBOARD_ISSUE_FIELDS} } }
  queued: search(query: $queued, type: ISSUE, first: 50) { nodes { ... on Issue { number title } } }
}`

const DASHBOARD_ONE_QUERY = `query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $n) { ${DASHBOARD_ISSUE_FIELDS} } }
}`

const DASHBOARD_ISSUE_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 10) {
    nodes { ... on Issue { id number url body comments(last: 30) { nodes { author { login } createdAt body } } } }
  }
}`

const CHECKS = { SUCCESS: '✅', FAILURE: '❌', ERROR: '❌', PENDING: '⏳', EXPECTED: '⏳' }

function age (from, now) {
  const hours = (now - new Date(from)) / 36e5
  if (hours < 1) return 'just now'
  if (hours < 48) return `${Math.round(hours)}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function median (values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function duration (ms) {
  if (ms === null) return 'n/a'
  const hours = ms / 36e5
  return hours < 48 ? `${Math.round(hours)}h` : `${(hours / 24).toFixed(1)}d`
}

function labelledAt (issue, name) {
  return issue.timelineItems.nodes.filter(e => e.label?.name === name).map(e => e.createdAt)
}

/** One line for an issue: its reference (a live link with a hover card), its title, then what's pending. */
function issueLine (issue, notes, done = false) {
  const title = issue.title.length > 70 ? issue.title.slice(0, 69) + '…' : issue.title
  return `- [${done ? 'x' : ' '}] #${issue.number} ${title}${notes.length ? ' · ' + notes.join(' · ') : ''}`
}

/** Where an open agent issue stands: who it's waiting on, and the notes for its line. */
export function issueStatus (issue, agent, lead, now, linkFor = threadUrl, climb = CLIMB) {
  const labels = issue.labels.nodes.map(l => l.name)
  const threadId = markerOf(issue.earliest.nodes, agent)
  const link = threadId && linkFor(threadId)
  const thread = link ? `[thread](${link})` : null
  const since = age(issue.updatedAt, now)
  const kind = kindOf(issue, lead, climb)

  if (kind !== 'issue') {
    const plan = planCommentOf(issue.earliest.nodes, agent)
    const phase = plan?.body.match(/\*\*Phase:\*\*\s*([\w-]+)/)?.[1] ?? 'starting'
    if (kind === 'climb') {
      // The climb's one-line scoreboard, such as "recall 0.81 → target 0.85 (E14)".
      const headline = plan?.body.match(/\*\*Headline:\*\*\s*(.+)/)?.[1].trim()
      return { group: 'climb', notes: [phase, headline, thread, since].filter(Boolean) }
    }
    const { total, completed } = issue.subIssuesSummary
    const notes = [phase, total ? `${completed}/${total} sub-issues` : null, thread, since].filter(Boolean)
    return { group: 'initiative', notes }
  }

  const pr = issue.closedByPullRequestsReferences.nodes.filter(p => p.state === 'OPEN').at(-1)
  const checks = pr && CHECKS[pr.commits.nodes[0]?.commit.statusCheckRollup?.state]
  const prNote = pr && `PR #${pr.number}${pr.isDraft ? ' draft' : ''}${checks ? ' ' + checks : ''}`

  if (labels.includes(QUESTION)) return { group: 'waiting', notes: ['❓ questions asked', prNote, thread, since].filter(Boolean) }
  if (pr && !pr.isDraft && pr.reviewDecision === 'APPROVED') return { group: 'waiting', notes: [`${prNote} approved, ready to merge`, since] }
  if (pr && !pr.isDraft && pr.reviewDecision !== 'CHANGES_REQUESTED') return { group: 'waiting', notes: [`${prNote} ready for review`, since] }
  const changes = pr?.reviewDecision === 'CHANGES_REQUESTED' ? 'changes requested' : null
  return { group: 'progress', notes: [prNote, changes, thread, since].filter(Boolean) }
}

/** The numbers for the last week, counting only agent issues and the PRs that close them. */
export function weekStats (data, now) {
  const since = new Date(now - WEEK).toISOString()
  const issues = [...data.open.nodes, ...data.closed.nodes]
  const started = issues.filter(i => labelledAt(i, AGENT_LABEL).some(t => t >= since))
  const toPr = started.flatMap(i => {
    const start = labelledAt(i, AGENT_LABEL)[0]
    const firstPr = i.closedByPullRequestsReferences.nodes.map(p => p.createdAt).sort()[0]
    return firstPr && firstPr >= start ? [new Date(firstPr) - new Date(start)] : []
  })
  const prs = new Map(issues.flatMap(i => i.closedByPullRequestsReferences.nodes).map(p => [p.number, p]))
  const merged = [...prs.values()].filter(p => p.mergedAt >= since)
  return {
    started: started.length,
    questions: issues.filter(i => labelledAt(i, QUESTION).some(t => t >= since)).length,
    prsOpened: [...prs.values()].filter(p => p.createdAt >= since).length,
    merged: merged.length,
    closedUnmerged: [...prs.values()].filter(p => p.state === 'CLOSED' && p.closedAt >= since).length,
    issuesClosed: data.closed.nodes.length,
    medianToPr: median(toPr),
    medianToMerge: median(merged.map(p => new Date(p.mergedAt) - new Date(p.createdAt)))
  }
}

function statsTable (stats) {
  return [
    '| Started | Asked questions | PRs opened | Merged | Closed unmerged | Issues closed |',
    '| --- | --- | --- | --- | --- | --- |',
    `| ${stats.started} | ${stats.questions} | ${stats.prsOpened} | ${stats.merged} | ${stats.closedUnmerged} | ${stats.issuesClosed} |`,
    '',
    `Median time from start to PR: ${duration(stats.medianToPr)} · from PR to merge: ${duration(stats.medianToMerge)}`
  ].join('\n')
}

/**
 * The dashboard's lists with one issue as read directly, in place of what
 * search returned: search can lag a label or close made seconds earlier.
 */
export function withIssue (data, fresh, now) {
  const labels = fresh.labels.nodes.map(l => l.name)
  const open = fresh.state === 'OPEN'
  let list = null
  if (labels.includes(AGENT_LABEL) && open) list = 'open'
  else if (labels.includes(AGENT_LABEL) && now - new Date(fresh.closedAt) < WEEK) list = 'closed'
  else if (open && labels.includes(READY)) list = 'queued'

  const result = {}
  for (const key of ['open', 'closed', 'queued']) {
    const nodes = data[key].nodes.filter(i => i.number !== fresh.number)
    if (key === list) {
      // Keep its place when search had it in the same list.
      const at = data[key].nodes.findIndex(i => i.number === fresh.number)
      nodes.splice(at < 0 ? nodes.length : at, 0, fresh)
    }
    result[key] = { nodes }
  }
  return result
}

/** The dashboard issue's body. */
export function renderDashboard (data, { agent, lead = LEAD, climb = CLIMB, now = Date.now(), linkFor = threadUrl }) {
  const groups = { waiting: [], progress: [], initiative: [], climb: [] }
  for (const issue of data.open.nodes) {
    const { group, notes } = issueStatus(issue, agent, lead, now, linkFor, climb)
    groups[group].push(issueLine(issue, notes))
  }
  const queued = data.queued.nodes.map(i => issueLine(i, []))
  const closed = data.closed.nodes.map(i => {
    const merged = i.closedByPullRequestsReferences.nodes.find(p => p.state === 'MERGED')
    return issueLine(i, merged ? [`PR #${merged.number} merged`] : [], true)
  })
  const section = (title, lines) => lines.length ? [`### ${title}`, ...lines, ''] : []
  const when = new Date(now).toISOString().slice(0, 16).replace('T', ' ')
  const open = [
    ...section('⏳ Waiting on people', groups.waiting),
    ...section('🧭 Initiatives', groups.initiative),
    ...section('🧪 Hill climbs', groups.climb),
    ...section('🚧 In progress', groups.progress),
    ...section('📥 Queued', queued)
  ]
  return [
    DASHBOARD_MARKER,
    `Issues handed to the agent. Updated ${when} UTC by the orchestrator, which replaces any edits.`,
    '',
    ...(open.length ? open : ['Nothing open: label an issue `ready` or assign it to the agent.', '']),
    ...section('✅ Closed in the last 7 days', closed),
    '### Last 7 days',
    statsTable(weekStats(data, now)),
    ''
  ].join('\n')
}

/** The weekly summary comment. */
export function renderWeekly (data, now = Date.now()) {
  const closed = data.closed.nodes.map(i => `- #${i.number} ${i.title}`)
  return [
    WEEKLY_MARKER,
    `### Week to ${new Date(now).toISOString().slice(0, 10)}`,
    '',
    statsTable(weekStats(data, now)),
    ...(closed.length ? ['', 'Closed:', ...closed] : []),
    ''
  ].join('\n')
}

/**
 * Rewrite the dashboard. The sweep creates and pins it, and posts the weekly
 * summary when due. With `refresh` (after a one-issue run) it only rewrites
 * an existing one, so the summary stays weekly and a dashboard that search
 * doesn't list yet isn't created twice. Issue `n` is read directly.
 */
function dashboard (repo, lead, climb, { dryRun, refresh, n }) {
  const { owner, name } = splitRepo(repo)
  const agent = graphql('query { viewer { login } }', {}).viewer.login
  const now = Date.now()
  const since = new Date(now - WEEK).toISOString().slice(0, 10)
  let data = graphql(DASHBOARD_QUERY, {
    open: `repo:${repo} is:issue is:open label:${AGENT_LABEL}`,
    closed: `repo:${repo} is:issue is:closed label:${AGENT_LABEL} closed:>=${since}`,
    queued: `repo:${repo} is:issue is:open label:${READY} -label:${AGENT_LABEL}`
  })
  const fresh = n && graphql(DASHBOARD_ONE_QUERY, { owner, name, n }).repository.issue
  if (fresh) data = withIssue(data, fresh, now)
  const body = renderDashboard(data, { agent, lead, climb, now })
  if (dryRun) return { body, weekly: renderWeekly(data, now) }
  const found = graphql(DASHBOARD_ISSUE_QUERY, { q: `repo:${repo} is:issue is:open author:${agent} in:title "Agent work"` })
    .search.nodes.find(i => i.body?.includes(DASHBOARD_MARKER))

  const result = { url: null, weekly: null }
  let issueId
  let comments = []
  if (found) {
    gh(['api', '--method', 'PATCH', `repos/${repo}/issues/${found.number}`, '--input', '-'], JSON.stringify({ body }))
    result.url = found.url
    issueId = found.id
    comments = found.comments.nodes
  } else if (!refresh) {
    const created = gh(['api', '--method', 'POST', `repos/${repo}/issues`, '--input', '-'], JSON.stringify({ title: DASHBOARD_TITLE, body }))
    result.url = created.html_url
    issueId = created.node_id
    try {
      graphql('mutation($id: ID!) { pinIssue(input: { issueId: $id }) { clientMutationId } }', { id: issueId })
      result.pinned = true
    } catch {
      // Pinning needs maintain access, and a repo pins at most three issues. The issue works unpinned.
      result.pinned = false
    }
  }

  if (refresh) return result
  const lastWeekly = comments.filter(c => c.author?.login === agent && c.body.includes(WEEKLY_MARKER)).at(-1)
  // Six hours early still counts as a week, so a sweep that runs a little earlier than last time still posts.
  if (!lastWeekly || now - new Date(lastWeekly.createdAt) >= WEEK - 36e5 * 6) {
    const number = result.url.split('/').at(-1)
    const posted = gh(['api', '--method', 'POST', `repos/${repo}/issues/${number}/comments`, '--input', '-'], JSON.stringify({ body: renderWeekly(data, now) }))
    result.weekly = posted.html_url
  }
  return result
}

/** A link to a thread that opens T3 Code, for whoever can reach this environment. */
export function threadUrl (threadId, env = process.env) {
  try {
    const environmentId = readFileSync(join(env.T3CODE_HOME ?? join(homedir(), '.t3'), 'userdata', 'environment-id'), 'utf8').trim()
    if (environmentId) return `https://app.t3.codes/${environmentId}/${threadId}`
  } catch {
    // Not running under T3 Code.
  }
  return null
}

/** The marker comment. `meta` (kind, model settings) goes in a hidden line for reports. */
export function markerBody (n, threadId, url = threadUrl(threadId), meta = {}) {
  const link = url ? `[#${n} in T3 Code](${url})` : `#${n} in T3 Code`
  const metaLine = Object.keys(meta).length ? `<!-- t3-meta: ${JSON.stringify(meta)} -->\n` : ''
  return `🤖 Started in a T3 Code thread: ${link}\nThread id: \`${threadId}\`\n\n<!-- t3-thread: ${threadId} -->\n${metaLine}`
}

function metaOf ({ kind, model }) {
  const meta = {}
  if (kind) meta.kind = kind
  if (model) meta.model = JSON.parse(model)
  return meta
}

function main () {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      repo: { type: 'string' },
      issue: { type: 'string' },
      thread: { type: 'string' },
      days: { type: 'string', default: '14' },
      lead: { type: 'string', default: LEAD },
      climb: { type: 'string', default: CLIMB },
      'body-file': { type: 'string' },
      parent: { type: 'string' },
      child: { type: 'string' },
      by: { type: 'string' },
      kind: { type: 'string' },
      model: { type: 'string' },
      'dry-run': { type: 'boolean' },
      refresh: { type: 'boolean' },
      whole: { type: 'boolean' }
    }
  })
  const command = positionals[0]
  const n = Number(values.issue)
  const hasNumber = Number.isInteger(n) && n > 0
  let out
  try {
    if (command === 'check' && hasNumber) out = JSON.stringify(check(values.repo, n, values.lead, values.climb))
    else if (command === 'sweep') out = JSON.stringify(sweep(values.repo, Number(values.days), values.lead, values.climb))
    else if (command === 'marker' && hasNumber && values.thread) out = markerBody(n, values.thread, threadUrl(values.thread), metaOf(values))
    else if (command === 'plan' && hasNumber) out = JSON.stringify(plan(values.repo, n))
    else if (command === 'plan-comment' && hasNumber && values['body-file']) out = JSON.stringify(planComment(values.repo, n, values['body-file']))
    else if (command === 'body' && hasNumber && values['body-file']) out = JSON.stringify(updateBody(values.repo, n, values['body-file'], values.whole))
    else if (command === 'sub-issue' && values.parent && values.child) out = JSON.stringify(addSubIssue(values.parent, values.child))
    else if (command === 'blocked-by' && values.issue && values.by) out = JSON.stringify(addBlockedBy(values.issue, values.by))
    else if (command === 'dashboard') out = JSON.stringify(dashboard(values.repo, values.lead, values.climb, { dryRun: values['dry-run'], refresh: values.refresh, n: hasNumber ? n : null }))
    else {
      process.stderr.write('usage: gh-work.mjs check | sweep | marker | plan | plan-comment | body | sub-issue | blocked-by | dashboard (see the top of this file)\n')
      process.exit(2)
    }
  } catch (error) {
    // One line the broker can quote in its result.
    process.stdout.write(JSON.stringify({ action: 'error', error: String(error.stderr || error.message).trim().split('\n')[0] }) + '\n')
    process.exit(1)
  }
  process.stdout.write(out.endsWith('\n') ? out : out + '\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
