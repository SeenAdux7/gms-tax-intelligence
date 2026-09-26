/**
 * Unit tests for the matching engine
 * ==================================
 *
 * `matchAssignment` is pure, so this needs no database and no browser. It runs
 * in milliseconds, which means it can be run on every change rather than only
 * before a commit.
 *
 * The cases below are the ones where a matcher goes quietly wrong. In
 * particular the jurisdiction hierarchy is asymmetric, and getting it backwards
 * would make every state-level development match every US assignment — a
 * failure that produces MORE results rather than fewer, so it would look like
 * the feature working.
 *
 * Run with:  npm run verify:matching
 */

import { matchAssignment, matchAssignments, type MatchableAssignment, type MatchableDevelopment } from '../app/lib/matching'

const failures: string[] = []

function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
  }
}

/* --- fixtures ------------------------------------------------------------ */

const ukDevelopment: MatchableDevelopment = {
  slug: 'uk-paye',
  headline: 'UK PAYE arrangement',
  status: 'official_guidance',
  jurisdictionCodes: ['GB'],
  topics: ['payroll', 'withholding'],
  populations: ['business_travelers', 'employers'],
  effectiveAt: '2027-04-06',
}

const usFederalDevelopment: MatchableDevelopment = {
  slug: 'us-days',
  headline: 'US day counting',
  status: 'official_guidance',
  jurisdictionCodes: ['US'],
  topics: ['tax_residency', 'withholding'],
  populations: ['business_travelers', 'remote_workers', 'employers'],
  effectiveAt: null,
}

const newYorkDevelopment: MatchableDevelopment = {
  slug: 'ny-convenience',
  headline: 'New York convenience rule',
  status: 'proposed',
  jurisdictionCodes: ['US-NY'],
  topics: ['individual_income_tax', 'payroll'],
  populations: ['domestic_state_workers', 'remote_workers', 'employers'],
  effectiveAt: null,
}

const ukAssignment: MatchableAssignment = {
  employeeRef: 'EMP-0101',
  homeJurisdiction: 'US',
  hostJurisdiction: 'GB',
  startDate: '2025-09-01',
  endDate: '2028-08-31',
  type: 'long_term',
  status: 'active',
  payrollLocations: ['US', 'GB'],
  compensationCategories: ['base_salary', 'equity'],
  benefits: ['housing'],
}

const canadaAssignment: MatchableAssignment = {
  employeeRef: 'EMP-0104',
  homeJurisdiction: 'US',
  hostJurisdiction: 'CA',
  startDate: '2026-10-05',
  endDate: '2026-11-20',
  type: 'business_traveler',
  status: 'planned',
  payrollLocations: ['US'],
  compensationCategories: ['base_salary'],
  benefits: [],
}

const newYorkAssignment: MatchableAssignment = {
  employeeRef: 'EMP-0106',
  homeJurisdiction: 'US-NJ',
  hostJurisdiction: 'US-NY',
  startDate: '2025-06-02',
  endDate: null,
  type: 'remote_worker',
  status: 'active',
  payrollLocations: ['US-NY'],
  compensationCategories: ['base_salary'],
  benefits: [],
}

const californiaAssignment: MatchableAssignment = {
  employeeRef: 'EMP-0110',
  homeJurisdiction: 'US',
  hostJurisdiction: 'US-CA',
  startDate: '2026-08-01',
  endDate: null,
  type: 'domestic_transfer',
  status: 'active',
  payrollLocations: ['US-CA'],
  compensationCategories: ['base_salary'],
  benefits: [],
}

const endedAssignment: MatchableAssignment = {
  employeeRef: 'EMP-0109',
  homeJurisdiction: 'CA',
  hostJurisdiction: 'US',
  startDate: '2024-01-15',
  endDate: '2025-12-31',
  type: 'short_term',
  status: 'ended',
  payrollLocations: ['CA', 'US'],
  compensationCategories: ['base_salary'],
  benefits: [],
}

/* --- jurisdiction is necessary ------------------------------------------ */

console.log('\nJurisdiction gating:')

check(
  'a UK development does not match a US->Canada assignment',
  matchAssignment(ukDevelopment, canadaAssignment) === null,
  'population and topic overlap alone must not produce a match',
)

check(
  'a UK development matches a US->UK assignment',
  matchAssignment(ukDevelopment, ukAssignment) !== null,
)

/* --- hierarchy is asymmetric -------------------------------------------- */

console.log('\nJurisdiction hierarchy:')

check(
  'a US federal development matches a New York assignment (parent covers child)',
  matchAssignment(usFederalDevelopment, newYorkAssignment) !== null,
)

check(
  'a New York development does NOT match a California assignment (siblings)',
  matchAssignment(newYorkDevelopment, californiaAssignment) === null,
  'if this fails, every state development matches every US assignment',
)

check(
  'a New York development matches a New York assignment',
  matchAssignment(newYorkDevelopment, newYorkAssignment) !== null,
)

/* --- dates -------------------------------------------------------------- */

console.log('\nDate handling:')

const ukMatch = matchAssignment(ukDevelopment, ukAssignment)!
check(
  'an in-scope assignment gets a date_range reason',
  ukMatch.reasons.includes('date_range'),
  ukMatch.reasons.join(','),
)

const endedMatch = matchAssignment(ukDevelopment, {
  ...endedAssignment,
  hostJurisdiction: 'GB',
  payrollLocations: ['GB'],
})!
check(
  'an ended assignment matches but has NO date_range reason',
  endedMatch !== null && !endedMatch.reasons.includes('date_range'),
  endedMatch?.reasons.join(','),
)
check(
  'an ended assignment says it may only matter for prior periods',
  endedMatch.explanation.includes('prior periods'),
)

const noDateMatch = matchAssignment(usFederalDevelopment, newYorkAssignment)!
check(
  'a development with no effective date reports that as an unknown',
  noDateMatch.unknowns.some((u) => u.includes('no effective date')),
  noDateMatch.unknowns.join(' | '),
)
check(
  'a development with no effective date gets NO date_range reason',
  !noDateMatch.reasons.includes('date_range'),
)

/* --- status-driven unknowns --------------------------------------------- */

console.log('\nStatus handling:')

const proposedMatch = matchAssignment(newYorkDevelopment, newYorkAssignment)!
check(
  'a proposed development warns against acting on it',
  proposedMatch.unknowns.some((u) => u.includes('not been adopted')),
  proposedMatch.unknowns.join(' | '),
)

const nullStatusMatch = matchAssignment(
  { ...newYorkDevelopment, status: null },
  newYorkAssignment,
)!
check(
  'a development with no stated status says to monitor rather than act',
  nullStatusMatch.unknowns.some((u) => u.includes('monitored rather than acted on')),
)

const plannedMatch = matchAssignment(
  { ...ukDevelopment, jurisdictionCodes: ['CA'] },
  canadaAssignment,
)!
check(
  'a planned assignment flags that facts may change',
  plannedMatch.unknowns.some((u) => u.includes('has not started yet')),
)

/* --- cancelled ---------------------------------------------------------- */

check(
  'a cancelled assignment never matches',
  matchAssignment(ukDevelopment, { ...ukAssignment, status: 'cancelled' }) === null,
)

/* --- explanations name specifics ---------------------------------------- */

console.log('\nExplanations:')

check(
  'explanation names the assignment',
  ukMatch.explanation.includes('EMP-0101'),
)
check(
  'explanation names where the jurisdiction matched',
  ukMatch.explanation.includes('host location'),
)
// The UK development names business travellers; EMP-0101 is a long-term
// expatriate. So there is NO employee-population match here, and the matcher
// must say so honestly rather than fall back on "employers", which is true of
// every assignment and would discriminate nothing.
check(
  'a non-matching population is reported honestly, not papered over',
  ukMatch.explanation.includes('does not name this assignment type'),
  ukMatch.explanation,
)
check(
  'employers alone does NOT count as a population reason',
  !ukMatch.reasons.includes('population'),
  ukMatch.reasons.join(','),
)

// A genuine employee-population match, for contrast: a Canadian development
// naming business travellers against a business-traveller assignment.
const canadaMatch = matchAssignment(
  {
    slug: 'ca-reg102',
    headline: 'Canada Reg 102 waivers',
    status: 'effective',
    jurisdictionCodes: ['CA'],
    topics: ['withholding', 'payroll'],
    populations: ['business_travelers', 'expatriates', 'employers'],
    effectiveAt: '2026-06-01',
  },
  canadaAssignment,
)!
check(
  'a real employee-population match names the population',
  canadaMatch.explanation.includes('business traveller'),
  canadaMatch.explanation,
)
check(
  'a real employee-population match counts as a reason',
  canadaMatch.reasons.includes('population'),
  canadaMatch.reasons.join(','),
)
check(
  'payroll topic explanation names the actual payroll locations',
  ukMatch.explanation.includes('split across US and GB'),
  ukMatch.explanation,
)
check(
  'split-payroll wording does not anchor on the host country',
  !ukMatch.explanation.includes('rather than only'),
  'anchoring on the host reads as though the host mattered to this development',
)

/* --- confidence and ordering -------------------------------------------- */

console.log('\nConfidence:')

check(
  'more corroborating signals means higher confidence',
  ukMatch.confidence === 'high' || ukMatch.confidence === 'medium',
  `${ukMatch.confidence} from ${ukMatch.reasons.length} reasons`,
)
check(
  'a bare jurisdiction-only match is low confidence',
  matchAssignment(
    {
      slug: 'x',
      headline: 'x',
      status: 'effective',
      jurisdictionCodes: ['GB'],
      topics: [],
      populations: [],
      effectiveAt: null,
    },
    ukAssignment,
  )?.confidence === 'low',
)

const ranked = matchAssignments(usFederalDevelopment, [
  californiaAssignment,
  newYorkAssignment,
  ukAssignment,
])
check(
  'results are ordered strongest first',
  ranked.length > 1 &&
    ['high', 'medium', 'low'].indexOf(ranked[0].confidence) <=
      ['high', 'medium', 'low'].indexOf(ranked[ranked.length - 1].confidence),
  ranked.map((r) => `${r.employeeRef}:${r.confidence}`).join(', '),
)
check(
  'a US federal development reaches assignments in US states',
  ranked.some((r) => r.employeeRef === 'EMP-0106' || r.employeeRef === 'EMP-0110'),
  ranked.map((r) => r.employeeRef).join(', '),
)

/* ----------------------------------------------------------------------- */

console.log('')
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed.`)
  process.exit(1)
}
console.log('All matching checks passed.')
