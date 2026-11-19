// Writes README.md from Sifter's public jobs data (https://sifter.finance/jobs.json).
// Plain Node 20, no packages. Run: node generate.mjs
import fs from 'node:fs'

const SOURCE = process.env.SOURCE || 'https://sifter.finance/jobs.json'
const SITE = 'https://sifter.finance'

const data = SOURCE.startsWith('http')
  ? await (await fetch(SOURCE)).json()
  : JSON.parse(fs.readFileSync(SOURCE, 'utf8'))
const jobs = data.jobs || []
if (jobs.length < 50) throw new Error(`only ${jobs.length} listings, keeping the old list`)

const AREAS = { investment_banking: 'Investment banking', sales_trading: 'Sales & trading', asset_management: 'Asset management', equity_research: 'Equity research', wealth_management: 'Wealth management', quant: 'Quant', credit: 'Credit & lending', corporate_finance: 'Corporate finance', accounting: 'Accounting & audit', consulting: 'Consulting & economics', risk_compliance: 'Risk & compliance', client_service: 'Client service & sales', operations: 'Operations', other: 'Other' }
const area = (a) => AREAS[a] || (a ? a.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : '')
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/[\r\n]+/g, ' ').trim()
const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const sorted = (list) => [...list].sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.firm.localeCompare(b.firm) || a.role.localeCompare(b.role))
const addDays = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// "2028" or "2029, 2030": the graduating classes the posting names. Blank when it names none.
const classOf = (j) => (j.class_years || []).slice().sort().join(', ')
const newest = (list) => [...list].sort((a, b) => b.opened_on.localeCompare(a.opened_on) || a.firm.localeCompare(b.firm) || a.role.localeCompare(b.role))

function table(list, byOpened = false) {
  const rows = (byOpened ? newest(list) : sorted(list)).map(j => `| ${cell(j.firm)} | [${cell(j.role).replace(/[\[\]]/g, '')}](${j.apply_url}) | ${cell(j.location)} | ${cell(area(j.area))} | ${classOf(j)} | ${byOpened ? `${day(j.opened_on)} | ` : ''}${j.deadline ? day(j.deadline) : 'Rolling'} |`)
  return [`| Firm | Role | Location | Area | Class of | ${byOpened ? 'Opened | ' : ''}Apply by |`, `|---|---|---|---|---|${byOpened ? '---|' : ''}---|`, ...rows].join('\n')
}

const interns = jobs.filter(j => j.kind === 'internship')
const summers = [...new Set(interns.map(j => j.summer).filter(Boolean))].sort().filter(y => interns.filter(j => j.summer === y).length >= 5)
const otherInterns = interns.filter(j => !summers.includes(j.summer))
const fullTime = jobs.filter(j => j.kind !== 'internship')
const week = addDays(7)
const closing = jobs.filter(j => j.deadline && j.deadline <= week)
// Roles the board first listed in the last seven days. The feed carries
// opened_on from 2026-11-19; without it this section is simply left out.
const weekAgo = addDays(-7)
const fresh = jobs.filter(j => j.opened_on && j.opened_on >= weekAgo)
// This school year's first-year class graduates four springs after the fall
// it started in: from August 2026, first-years are the class of 2030.
const now = new Date()
const firstYear = now.getUTCFullYear() + (now.getUTCMonth() >= 7 ? 4 : 3)
const inClass = (y) => jobs.filter(j => (j.class_years || []).map(Number).includes(y))
const firms = new Set(jobs.map(j => j.firm)).size
const anchor = (t) => t.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')

const sections = [
  [`New this week (${fresh.length})`, fresh, true],
  [`Closing in the next seven days (${closing.length})`, closing],
  ...summers.map(y => [`Summer ${y} finance internships (${interns.filter(j => j.summer === y).length})`, interns.filter(j => j.summer === y)]),
  [`Open to first-year students, class of ${firstYear} (${inClass(firstYear).length})`, inClass(firstYear)],
  [`Open to sophomores, class of ${firstYear - 1} (${inClass(firstYear - 1).length})`, inClass(firstYear - 1)],
  [`Other internships (${otherInterns.length})`, otherInterns],
  [`Full-time roles for new graduates (${fullTime.length})`, fullTime],
].filter(([, list]) => list.length)
const seasons = summers.length ? `Summer ${summers.join(' and ')} finance internships` : 'Finance internships'

const md = `# ${seasons}, and first jobs for students

Open internships and entry-level roles at banks, asset managers, research shops, trading firms and wealth managers, sorted by deadline. Every link goes to the firm's own posting.

**${jobs.length} open roles at ${firms} firms as of ${day(data.as_of)}.** Rebuilt every day from the [Sifter jobs board](${SITE}/jobs). A role leaves the list when it closes or comes down from the firm's site.

If the list is useful, a star helps other students find it.

## Contents

${sections.map(([t]) => `- [${t}](#${anchor(t)})`).join('\n')}
- [Filter, save and get reminders on Sifter](#filter-save-and-get-reminders-on-sifter)
- [Ask an AI assistant](#ask-an-ai-assistant)
- [About this list](#about-this-list)

${sections.map(([t, list, byOpened]) => `## ${t}\n\n${table(list, byOpened)}`).join('\n\n')}

## Filter, save and get reminders on Sifter

This page is the plain list. On [Sifter](${SITE}/jobs), free for students with a school email, you can:

- filter by class year, area and city, and see the roles on a map
- see every deadline on a calendar
- save roles, follow firms and get a reminder before a role closes
- track your applications

Sifter is also where students build the record that goes with an application: on the [Training Floor](${SITE}/training-floor) you make dated stock calls with your reasoning, and the results stay on a [Sifter Card](${SITE}/sifter-card) you can send to an employer.

## Ask an AI assistant

This repository is also an MCP server, so Claude and other AI assistants can answer questions from the list: "which investment banking internships in New York close this week?", "who is hiring quant interns for summer 2027?", "which roles for the class of 2028 state their pay?"

It reads the same public list as this page. No account and no key. It needs Node 18 or later.

Claude Code:

\`\`\`bash
claude mcp add finance-internships -- npx -y github:sifterfinance/finance-internships
\`\`\`

Claude Desktop, Cursor and others (in the MCP settings file):

\`\`\`json
{ "mcpServers": { "finance-internships": { "command": "npx", "args": ["-y", "github:sifterfinance/finance-internships"] } } }
\`\`\`

Sifter is the platform for student investors and the funds they run, built by university professors. It also has a [free DCF model](${SITE}/dcf), a [free textbook on portfolio performance](${SITE}/textbook) and the [Sifter Card](${SITE}/sifter-card), an investing record a student can show an employer.

## About this list

- The listings come from firms' public career pages. Sifter is not the employer and does not take applications.
- Dates are the closing dates the firm gave. "Rolling" means the firm gave no date, and those roles can close at any time.
- A role is filed under a summer when it is an internship and its title carries that year.
- "Class of" is the graduating class the posting names. When a posting names none, the column is blank, so read the posting before ruling yourself out.
- A role appears in more than one section when it fits more than one.
- Something wrong or missing? Open an issue here, or email admin@sifterfinance.com.
`

fs.writeFileSync('README.md', md)
console.log(`README.md: ${jobs.length} roles, ${firms} firms, ${sections.length} sections`)
