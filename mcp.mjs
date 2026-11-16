#!/usr/bin/env node
// An MCP server for the Sifter jobs board. It lets an AI assistant answer
// questions about open finance internships and first jobs.
//
// It reads one public file, https://sifter.finance/jobs.json, and nothing else.
// No keys, no account, no dependencies. It speaks MCP over stdio.
//
//   npx -y github:sifterfinance/finance-internships

import { createInterface } from 'node:readline'

const FEED = 'https://sifter.finance/jobs.json'
const CACHE_MS = 30 * 60 * 1000
const VERSION = '1.0.0'

const AREAS = {
  investment_banking: 'Investment banking',
  sales_trading: 'Sales & trading',
  asset_management: 'Asset management',
  equity_research: 'Equity research',
  wealth_management: 'Wealth management',
  quant: 'Quant',
  credit: 'Credit & lending',
  corporate: 'Risk, finance & operations',
  other: 'Other',
}
const AREA_KEYS = Object.keys(AREAS)

// ── the feed ────────────────────────────────────────────────────────────────

let cache = null
let cachedAt = 0

async function loadBoard() {
  if (cache && Date.now() - cachedAt < CACHE_MS) return cache
  try {
    const res = await fetch(FEED, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`the jobs feed answered ${res.status}`)
    const data = await res.json()
    if (!Array.isArray(data.jobs)) throw new Error('the jobs feed had no list of jobs')
    cache = data
    cachedAt = Date.now()
    return cache
  } catch (err) {
    if (cache) return cache // an older copy beats no answer
    throw err
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
const todayISO = () => new Date().toISOString().slice(0, 10)
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Soonest deadline first; roles with no stated deadline ("rolling") last.
const byDeadline = (a, b) => {
  if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline) || a.firm.localeCompare(b.firm)
  if (a.deadline) return -1
  if (b.deadline) return 1
  return a.firm.localeCompare(b.firm) || a.role.localeCompare(b.role)
}

function payText(p) {
  if (!p || p.min == null) return null
  const n = (x) => (p.per === 'hour' ? `$${x}` : `$${Number(x).toLocaleString('en-US')}`)
  const range = p.max != null && p.max !== p.min ? `${n(p.min)} to ${n(p.max)}` : n(p.min)
  return `${range} per ${p.per || 'year'}`
}

function shape(j) {
  return {
    firm: j.firm,
    role: j.role,
    kind: j.kind === 'full_time' ? 'full-time' : 'internship',
    area: AREAS[j.area] || j.area || null,
    location: j.location || null,
    class_years: j.class_years?.length ? j.class_years : null,
    summer: j.summer || null,
    apply_by: j.deadline || 'rolling (no stated deadline)',
    pay: payText(j.pay),
    apply_url: j.apply_url,
    sifter_page: j.page,
  }
}

function filterJobs(jobs, a) {
  const today = todayISO()
  const words = norm(a.query).split(/\s+/).filter(Boolean)
  const firm = norm(a.firm)
  const loc = norm(a.location)
  const until = Number.isFinite(a.closing_within_days) ? addDays(today, Math.max(0, a.closing_within_days)) : null
  return jobs.filter((j) => {
    if (j.deadline && j.deadline < today) return false // closed since the last rebuild
    if (a.kind && j.kind !== a.kind) return false
    if (a.area && j.area !== a.area) return false
    if (firm && !norm(j.firm).includes(firm)) return false
    if (loc && !norm(j.location).includes(loc)) return false
    if (a.summer && String(j.summer || '') !== String(a.summer)) return false
    if (a.class_year && !(j.class_years || []).includes(Number(a.class_year))) return false
    if (until && !(j.deadline && j.deadline <= until)) return false
    if (a.has_pay && !j.pay) return false
    if (words.length) {
      const hay = norm(`${j.firm} ${j.role} ${j.location} ${AREAS[j.area] || ''}`)
      if (!words.every((w) => hay.includes(w))) return false
    }
    return true
  })
}

const tally = (list, key) => {
  const m = new Map()
  for (const j of list) {
    const k = key(j)
    if (k == null || k === '') continue
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
}

const stamp = (board) => ({
  as_of: board.as_of,
  source: 'Sifter jobs board, https://sifter.finance/jobs',
  note: 'Every apply_url goes to the firm\'s own posting. Check the posting before applying: a role can close early.',
})

// ── tools ───────────────────────────────────────────────────────────────────

const FILTERS = {
  query: { type: 'string', description: 'Words that must all appear in the firm, role title, location or area. Example: "private equity analyst".' },
  firm: { type: 'string', description: 'Part of a firm\'s name. Example: "Goldman".' },
  kind: { type: 'string', enum: ['internship', 'full_time'], description: 'internship, or full_time for entry-level roles for new graduates.' },
  area: { type: 'string', enum: AREA_KEYS, description: 'The part of finance. corporate means risk, finance and operations; credit means credit and lending.' },
  location: { type: 'string', description: 'Part of a city or state as written on the board. Examples: "New York", "TX", "Chicago". Roles in several cities are listed as "Multiple".' },
  class_year: { type: 'integer', description: 'Graduation year the role is open to. Example: 2028. Roles that do not state class years are left out when this is set.' },
  summer: { type: 'string', description: 'The summer an internship runs. Example: "2027".' },
  closing_within_days: { type: 'integer', minimum: 0, description: 'Only roles whose deadline falls within this many days from today. Rolling roles are left out.' },
  has_pay: { type: 'boolean', description: 'Only roles whose posting states pay.' },
}

const TOOLS = [
  {
    name: 'search_jobs',
    description:
      'Search open finance internships and entry-level finance jobs for students on the Sifter jobs board (banks, asset managers, research shops, trading firms, wealth managers; mostly US and Canada). ' +
      'Every filter is optional and they combine. Results come soonest deadline first, rolling roles last, each with the link to the firm\'s own posting. ' +
      'The answer carries the date the list was built; say that date when you report results.',
    inputSchema: {
      type: 'object',
      properties: {
        ...FILTERS,
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'How many roles to return. Default 25.' },
        offset: { type: 'integer', minimum: 0, description: 'Skip this many roles, to page through a long list.' },
      },
      additionalProperties: false,
    },
    async run(a) {
      const board = await loadBoard()
      const hits = filterJobs(board.jobs, a).sort(byDeadline)
      const limit = Math.min(100, Math.max(1, a.limit ?? 25))
      const offset = Math.max(0, a.offset ?? 0)
      const page = hits.slice(offset, offset + limit)
      return {
        ...stamp(board),
        matching: hits.length,
        returned: page.length,
        offset,
        more: offset + page.length < hits.length,
        jobs: page.map(shape),
      }
    },
  },
  {
    name: 'list_firms',
    description:
      'List the firms with open roles on the Sifter jobs board and how many each has, most roles first. Takes the same filters as search_jobs, so it can answer "which firms are hiring quant interns in Chicago".',
    inputSchema: {
      type: 'object',
      properties: { ...FILTERS, limit: { type: 'integer', minimum: 1, maximum: 500, description: 'How many firms to return. Default 50.' } },
      additionalProperties: false,
    },
    async run(a) {
      const board = await loadBoard()
      const hits = filterJobs(board.jobs, a)
      const firms = new Map()
      for (const j of hits) {
        const f = firms.get(j.firm) || { firm: j.firm, open_roles: 0, internships: 0, full_time: 0, next_deadline: null }
        f.open_roles += 1
        if (j.kind === 'full_time') f.full_time += 1
        else f.internships += 1
        if (j.deadline && (!f.next_deadline || j.deadline < f.next_deadline)) f.next_deadline = j.deadline
        firms.set(j.firm, f)
      }
      const all = [...firms.values()].sort((x, y) => y.open_roles - x.open_roles || x.firm.localeCompare(y.firm))
      const limit = Math.min(500, Math.max(1, a.limit ?? 50))
      return { ...stamp(board), firms_matching: all.length, roles_matching: hits.length, firms: all.slice(0, limit) }
    },
  },
  {
    name: 'board_summary',
    description:
      'Counts for the whole Sifter jobs board: how many roles are open, by kind, area, summer and city, and how many close in the next seven days. Use it for "how many", "what areas" and "where are the jobs" questions, or before a search to see what is there.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const board = await loadBoard()
      const jobs = filterJobs(board.jobs, {})
      const today = todayISO()
      const week = addDays(today, 7)
      return {
        ...stamp(board),
        open_roles: jobs.length,
        firms: new Set(jobs.map((j) => j.firm)).size,
        internships: jobs.filter((j) => j.kind !== 'full_time').length,
        full_time: jobs.filter((j) => j.kind === 'full_time').length,
        closing_in_seven_days: jobs.filter((j) => j.deadline && j.deadline <= week).length,
        rolling_no_deadline: jobs.filter((j) => !j.deadline).length,
        by_area: tally(jobs, (j) => j.area).map(([k, n]) => ({ area: k, label: AREAS[k] || k, roles: n })),
        by_summer: tally(jobs.filter((j) => j.kind !== 'full_time'), (j) => j.summer).map(([k, n]) => ({ summer: k, internships: n })),
        top_locations: tally(jobs, (j) => j.location).slice(0, 25).map(([k, n]) => ({ location: k, roles: n })),
      }
    },
  },
]

// ── MCP over stdio (newline-delimited JSON-RPC 2.0) ─────────────────────────

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

async function handle(msg) {
  const { id, method, params } = msg
  const isRequest = id !== undefined && id !== null
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'sifter-finance-internships', title: 'Finance internships (Sifter jobs board)', version: VERSION },
        instructions:
          'Open finance internships and entry-level finance jobs for students, from the Sifter jobs board (https://sifter.finance/jobs), rebuilt daily. ' +
          'Report the as_of date with any answer, link each role to its apply_url, and call a role with no deadline "rolling".',
      })
    case 'ping':
      return reply(id, {})
    case 'tools/list':
      return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name)
      if (!tool) return fail(id, -32602, `Unknown tool: ${params?.name}`)
      try {
        const out = await tool.run(params.arguments || {})
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] })
      } catch (err) {
        return reply(id, { content: [{ type: 'text', text: `Could not read the jobs board: ${err.message}` }], isError: true })
      }
    }
    case 'resources/list':
      return reply(id, { resources: [] })
    case 'prompts/list':
      return reply(id, { prompts: [] })
    default:
      if (isRequest) fail(id, -32601, `Method not found: ${method}`)
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
let pending = Promise.resolve()
rl.on('line', (line) => {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return fail(null, -32700, 'Parse error')
  }
  pending = pending.then(() => handle(msg)).catch((err) => {
    if (msg?.id != null) fail(msg.id, -32603, err.message)
  })
})
rl.on('close', () => pending.finally(() => process.exit(0)))
