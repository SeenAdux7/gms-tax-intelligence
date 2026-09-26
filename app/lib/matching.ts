/**
 * Development-to-assignment matching
 * ==================================
 *
 * "When a relevant development is found, the application may identify synthetic
 * assignments that share the affected jurisdiction, employee type, date range,
 * or issue category. It should explain why each assignment was matched and
 * label the result as a potential review item, not a legal determination."
 *
 * Pure functions. No database, no model — this is set intersection and date
 * comparison, which is exactly what the brief means by "use deterministic code
 * for dates, counts, filters, calculations, and status tracking". A model here
 * would be slower, more expensive, non-reproducible, and unable to tell you
 * why it did what it did.
 *
 * THE CENTRAL DESIGN DECISION
 *
 * Jurisdiction is NECESSARY. Everything else only amplifies.
 *
 * Without that rule, an Irish tax development would "match" a US-to-Canada
 * assignment because both involve expatriates and both touch payroll. That is
 * not a lead, it is noise — and a review queue full of noise is worse than no
 * review queue, because a GMS team learns to ignore it. So a match requires a
 * jurisdiction overlap first; population, dates, topic and payroll location
 * then raise or lower confidence and add to the explanation.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not decide anything. Every output is phrased as something to review,
 * and `UNKNOWNS` collects the facts that would be needed before a conclusion
 * could be reached. A development with no stated effective date cannot be
 * date-matched, and the explanation says so rather than quietly assuming the
 * assignment is in scope.
 */

import type { AffectedPopulation, DevelopmentStatus, Topic } from './labels'

/* ==========================================================================
 * Inputs
 * ========================================================================== */

export type MatchableDevelopment = {
  slug: string
  headline: string
  status: DevelopmentStatus | null
  /** Jurisdiction codes the development affects, any role. */
  jurisdictionCodes: string[]
  topics: Topic[]
  populations: AffectedPopulation[]
  /** ISO date, or null when the source states none. */
  effectiveAt: string | null
}

export type MatchableAssignment = {
  employeeRef: string
  homeJurisdiction: string
  hostJurisdiction: string
  /** ISO dates. `endDate` null means open-ended. */
  startDate: string
  endDate: string | null
  type:
    | 'long_term'
    | 'short_term'
    | 'commuter'
    | 'business_traveler'
    | 'remote_worker'
    | 'domestic_transfer'
  status: 'planned' | 'active' | 'ended' | 'cancelled'
  payrollLocations: string[]
  compensationCategories: string[]
  benefits: string[]
}

export type MatchReason =
  | 'jurisdiction'
  | 'population'
  | 'date_range'
  | 'topic'
  | 'payroll_location'

export type Match = {
  employeeRef: string
  reasons: MatchReason[]
  /** Plain-language "why this matched", assembled from the reasons that fired. */
  explanation: string
  /** Facts that would be needed before any conclusion — often the useful part. */
  unknowns: string[]
  /** More reasons means a stronger lead, not a stronger legal position. */
  confidence: 'low' | 'medium' | 'high'
}

/* ==========================================================================
 * Jurisdiction
 * ========================================================================== */

/**
 * Does a development jurisdiction cover an assignment jurisdiction?
 *
 * Hierarchy-aware in one direction only, and the asymmetry is the point:
 *
 *   - A US FEDERAL development affects someone in New York. 'US' covers
 *     'US-NY'.
 *   - A NEW YORK development does NOT affect someone in California just
 *     because both are US. 'US-NY' does not cover 'US-CA'.
 *
 * Getting this backwards would make every state development match every US
 * assignment, which is the most likely way this matcher could become useless.
 */
function jurisdictionCovers(developmentCode: string, assignmentCode: string): boolean {
  if (developmentCode === assignmentCode) return true
  // Parent covers child: 'US' covers 'US-NY'.
  if (assignmentCode.startsWith(`${developmentCode}-`)) return true
  return false
}

function matchingJurisdictions(
  development: MatchableDevelopment,
  assignment: MatchableAssignment,
): { code: string; where: string }[] {
  const places: { code: string; where: string }[] = [
    { code: assignment.hostJurisdiction, where: 'host location' },
    { code: assignment.homeJurisdiction, where: 'home location' },
    ...assignment.payrollLocations.map((code) => ({ code, where: 'payroll location' })),
  ]

  const hits: { code: string; where: string }[] = []
  const seen = new Set<string>()

  for (const place of places) {
    if (seen.has(`${place.code}|${place.where}`)) continue
    if (development.jurisdictionCodes.some((dc) => jurisdictionCovers(dc, place.code))) {
      hits.push(place)
      seen.add(`${place.code}|${place.where}`)
    }
  }

  return hits
}

/* ==========================================================================
 * Population
 * ========================================================================== */

/**
 * Which EMPLOYEE population categories an assignment type falls into.
 *
 * `employers` is deliberately absent. Every assignment has an employer, so
 * including it here would make the population signal fire on every single
 * match whenever a development lists employers as affected — which is almost
 * always. Two bad consequences: the explanation ends up saying the least
 * informative thing available ("an employer obligation") instead of naming the
 * actual employee population, and every match collects a free confidence point,
 * which makes confidence meaningless.
 *
 * The employer angle is still reported — see `employerObligation` below — it
 * just does not count as corroboration, because it is never discriminating.
 */
const EMPLOYEE_POPULATIONS_BY_TYPE: Record<
  MatchableAssignment['type'],
  AffectedPopulation[]
> = {
  long_term: ['expatriates'],
  short_term: ['expatriates', 'business_travelers'],
  commuter: ['business_travelers'],
  business_traveler: ['business_travelers'],
  remote_worker: ['remote_workers'],
  domestic_transfer: ['domestic_state_workers'],
}

const POPULATION_PHRASES: Record<AffectedPopulation, string> = {
  expatriates: 'an expatriate assignee',
  business_travelers: 'a business traveller',
  remote_workers: 'a remote worker',
  domestic_state_workers: 'a domestic state-to-state worker',
  employers: 'an employer obligation',
  other: 'an affected group',
}

/* ==========================================================================
 * Dates
 * ========================================================================== */

/**
 * Is the assignment live when the development takes effect?
 *
 * Returns null — not false — when the answer is unknowable, which happens when
 * the source states no effective date. That distinction matters: false means
 * "checked, not in scope", null means "cannot be checked", and the explanation
 * treats them differently.
 */
function overlapsEffectiveDate(
  development: MatchableDevelopment,
  assignment: MatchableAssignment,
): boolean | null {
  if (!development.effectiveAt) return null
  if (assignment.status === 'cancelled') return false

  const effective = Date.parse(`${development.effectiveAt}T00:00:00Z`)
  const start = Date.parse(`${assignment.startDate}T00:00:00Z`)
  const end = assignment.endDate ? Date.parse(`${assignment.endDate}T00:00:00Z`) : null

  if (Number.isNaN(effective) || Number.isNaN(start)) return null
  if (effective < start) return false
  if (end !== null && effective > end) return false
  return true
}

/* ==========================================================================
 * Topic
 * ========================================================================== */

/**
 * Topic relevance, derived from assignment facts rather than asserted.
 *
 * Each rule below returns the REASON it fired, so the explanation can name the
 * specific feature of the assignment that made the topic relevant. A rule that
 * matched but could not say why would be no better than a guess.
 */
function topicRelevance(
  development: MatchableDevelopment,
  assignment: MatchableAssignment,
): string[] {
  const notes: string[] = []
  const topics = new Set(development.topics)

  // Payroll run somewhere other than the host country is the shadow-payroll
  // situation, which is what payroll and withholding developments land on.
  //
  // Phrased around the SPLIT rather than "rather than only <host>". Anchoring
  // on the host country reads as though the host mattered to this particular
  // development, which is wrong when the development belongs to a different
  // jurisdiction — a US withholding rule is relevant because pay is delivered
  // across borders, not because the host happens to be the UK.
  const payrollElsewhere = assignment.payrollLocations.some(
    (code) => code !== assignment.hostJurisdiction,
  )
  if ((topics.has('payroll') || topics.has('withholding')) && payrollElsewhere) {
    notes.push(
      assignment.payrollLocations.length > 1
        ? `payroll is split across ${assignment.payrollLocations.join(' and ')}, so pay may be delivered from outside the country where the work is done`
        : `payroll is run from ${assignment.payrollLocations[0]} while the work is done in ${assignment.hostJurisdiction}`,
    )
  }

  // No host-country payroll at all is a stronger version of the same point.
  if (
    (topics.has('payroll') || topics.has('withholding')) &&
    !assignment.payrollLocations.includes(assignment.hostJurisdiction)
  ) {
    notes.push(`there is no payroll registered in ${assignment.hostJurisdiction}`)
  }

  if (topics.has('compensation') && assignment.compensationCategories.includes('equity')) {
    notes.push('the assignee holds equity compensation')
  }

  if (topics.has('benefits') && assignment.benefits.length > 0) {
    notes.push(`the assignment includes ${assignment.benefits.join(', ')}`)
  }

  // Social security agreements only bite across national borders, so a
  // state-to-state move is not relevant however much payroll it involves.
  const crossBorder = countryOf(assignment.homeJurisdiction) !== countryOf(assignment.hostJurisdiction)
  if (topics.has('social_security') && crossBorder) {
    notes.push('the assignment crosses a national border, so social security coverage is in scope')
  }

  if (topics.has('tax_residency') && crossBorder) {
    notes.push('the assignee works across borders, so day counts affect their residence position')
  }

  if (topics.has('assignment_policy')) {
    notes.push('assignment policy terms may need revisiting')
  }

  return notes
}

/** 'US-NY' -> 'US'. Used to tell an international move from a domestic one. */
function countryOf(code: string): string {
  return code.split('-')[0]
}

/* ==========================================================================
 * The matcher
 * ========================================================================== */

export function matchAssignment(
  development: MatchableDevelopment,
  assignment: MatchableAssignment,
): Match | null {
  // Cancelled assignments are not review items.
  if (assignment.status === 'cancelled') return null

  // Jurisdiction is necessary. No overlap, no match — see the header note.
  const places = matchingJurisdictions(development, assignment)
  if (places.length === 0) return null

  const reasons: MatchReason[] = ['jurisdiction']
  const sentences: string[] = []
  const unknowns: string[] = []

  const placeList = places.map((p) => `${p.code} (${p.where})`).join(', ')
  sentences.push(`This development affects ${placeList} for ${assignment.employeeRef}.`)

  if (places.some((p) => p.where === 'payroll location')) {
    reasons.push('payroll_location')
  }

  /* --- population -----------------------------------------------------
   * Only an EMPLOYEE population match counts as a reason. The employer angle
   * is reported separately and does not raise confidence, because it is true
   * of every assignment and so discriminates nothing. */
  const employeeHits = EMPLOYEE_POPULATIONS_BY_TYPE[assignment.type].filter((p) =>
    development.populations.includes(p),
  )

  if (employeeHits.length > 0) {
    reasons.push('population')
    sentences.push(
      `The assignment is ${POPULATION_PHRASES[employeeHits[0]]}, which this development names as affected.`,
    )
  } else if (development.populations.includes('employers')) {
    sentences.push(
      'The development names employer obligations as affected, though it does not name this assignment type among the affected employee groups.',
    )
  }

  /* --- dates ---------------------------------------------------------- */
  const overlap = overlapsEffectiveDate(development, assignment)
  if (overlap === true) {
    reasons.push('date_range')
    sentences.push(
      `The assignment runs across the effective date of ${development.effectiveAt}.`,
    )
  } else if (overlap === false) {
    // Still reported, because a jurisdiction match on a finished assignment can
    // matter for prior-year filings — but it must not read as in-scope.
    sentences.push(
      `The assignment does not run across the effective date of ${development.effectiveAt}, so this may only be relevant to prior periods.`,
    )
  } else {
    unknowns.push(
      'The source states no effective date, so it is not known whether this assignment falls within scope.',
    )
  }

  /* --- topic ---------------------------------------------------------- */
  const topicNotes = topicRelevance(development, assignment)
  if (topicNotes.length > 0) {
    reasons.push('topic')
    sentences.push(`Relevant because ${topicNotes.join('; ')}.`)
  }

  /* --- status-driven unknowns ----------------------------------------- */
  if (development.status === 'proposed' || development.status === 'discussion') {
    unknowns.push(
      'This development has not been adopted, so no action should be taken on the basis of it yet.',
    )
  }
  if (development.status === null) {
    unknowns.push(
      'The source does not state where this sits in the legal process, so it should be monitored rather than acted on.',
    )
  }
  if (assignment.status === 'planned') {
    unknowns.push(
      `${assignment.employeeRef} has not started yet, so the facts may change before the assignment begins.`,
    )
  }

  /* --- confidence ------------------------------------------------------
   * A count of corroborating signals, nothing more. It says how likely this is
   * worth a look, NOT how likely the development applies — that is a judgement
   * this app does not make. */
  const confidence: Match['confidence'] =
    reasons.length >= 4 ? 'high' : reasons.length >= 3 ? 'medium' : 'low'

  return {
    employeeRef: assignment.employeeRef,
    reasons,
    explanation: sentences.join(' '),
    unknowns,
    confidence,
  }
}

/** Matches a development against a whole population, strongest first. */
export function matchAssignments(
  development: MatchableDevelopment,
  population: MatchableAssignment[],
): Match[] {
  const order = { high: 0, medium: 1, low: 2 } as const
  return population
    .map((assignment) => matchAssignment(development, assignment))
    .filter((match): match is Match => match !== null)
    .sort(
      (a, b) =>
        order[a.confidence] - order[b.confidence] ||
        a.employeeRef.localeCompare(b.employeeRef),
    )
}

/**
 * The label every match must carry.
 *
 * Exported as a constant so the wording cannot drift between screens. The brief
 * is explicit that these are "a potential review item, not a legal
 * determination", and that phrasing is a requirement rather than a nicety.
 */
export const MATCH_DISCLAIMER =
  'Potential review items, not legal determinations. These assignments share a jurisdiction, population, date range, or issue category with the development — a professional still has to decide whether anything actually applies.'
