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

const AREAS = { investment_banking: 'Investment banking', sales_trading: 'Sales & trading', asset_management: 'Asset management', equity_research: 'Equity research', wealth_management: 'Wealth management', quant: 'Quant', credit: 'Credit & lending', corporate: 'Risk, finance & operations', other: 'Other' }
const area = (a) => AREAS[a] || (a ? a.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : '')
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/[\r\n]+/g, ' ').trim()
const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const sorted = (list) => [...list].sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.firm.localeCompare(b.firm) || a.role.localeCompare(b.role))
const addDays = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

function table(list) {
  const rows = sorted(list).map(j => `| ${cell(j.firm)} | [${cell(j.role).replace(/[\[\]]/g, '')}](${j.apply_url}) | ${cell(j.location)} | ${cell(area(j.area))} | ${j.deadline ? day(j.deadline) : 'Rolling'} |`)
  return ['| Firm | Role | Location | Area | Apply by |', '|---|---|---|---|---|', ...rows].join('\n')
}

const interns = jobs.filter(j => j.kind === 'internship')
const summers = [...new Set(interns.map(j => j.summer).filter(Boolean))].sort().filter(y => interns.filter(j => j.summer === y).length >= 5)
const otherInterns = interns.filter(j => !summers.includes(j.summer))
const fullTime = jobs.filter(j => j.kind !== 'internship')
const week = addDays(7)
const closing = jobs.filter(j => j.deadline && j.deadline <= week)
const firms = new Set(jobs.map(j => j.firm)).size
const anchor = (t) => t.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')

const sections = [
  [`Closing in the next seven days (${closing.length})`, closing],
  ...summers.map(y => [`Summer ${y} internships (${interns.filter(j => j.summer === y).length})`, interns.filter(j => j.summer === y)]),
  [`Other internships (${otherInterns.length})`, otherInterns],
  [`Full-time roles for new graduates (${fullTime.length})`, fullTime],
].filter(([, list]) => list.length)

const md = `# Finance internships and first jobs for students

Open internships and entry-level roles at banks, asset managers, research shops, trading firms and wealth managers, in the order they close. Every link goes to the firm's own posting.

**${jobs.length} open roles at ${firms} firms as of ${day(data.as_of)}.** The list is rebuilt every day from the [Sifter jobs board](${SITE}/jobs). A role leaves the list when it closes or comes down from the firm's site.

## Contents

${sections.map(([t]) => `- [${t}](#${anchor(t)})`).join('\n')}

## Get more from the board

This page is the plain list. On [Sifter](${SITE}/jobs), free for students with a school email, you can:

- filter by class year, area and city, and see the roles on a map
- see every deadline on a calendar
- save roles, follow firms and get a reminder before a role closes
- track your applications

Sifter is the platform for student investors and the funds they run, built by university professors. It also has a [free DCF model](${SITE}/dcf), a [free textbook on portfolio performance](${SITE}/textbook) and the [Sifter Card](${SITE}/sifter-card), an investing record a student can show an employer.

${sections.map(([t, list]) => `## ${t}\n\n${table(list)}`).join('\n\n')}

## About this list

- The listings come from firms' public career pages. Sifter is not the employer and does not take applications.
- Dates are the closing dates the firm gave. "Rolling" means the firm gave no date, and those roles can close at any time.
- A role is filed under a summer when it is an internship and its title carries that year.
- Something wrong or missing? Open an issue here, or email admin@sifterfinance.com.
`

fs.writeFileSync('README.md', md)
console.log(`README.md: ${jobs.length} roles, ${firms} firms, ${sections.length} sections`)
