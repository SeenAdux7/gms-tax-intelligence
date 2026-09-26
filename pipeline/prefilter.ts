/**
 * Free keyword prefilter
 * ======================
 *
 * A deterministic, zero-cost gate that runs BEFORE the Haiku relevance screen.
 *
 * WHY THIS EARNS ITS PLACE
 *
 * The Canadian source is an all-department Government of Canada feed, because
 * the CRA's own department filter returns nothing (see db/seed-sources.ts). A
 * live run pulled "Secretary of State participates in the 81st United Nations
 * General Assembly" and "new funding for Cycling Canada". Those are obviously
 * not mobility tax items, and paying a model $0.0025 to tell us so — on every
 * such item, every hour — is money spent to learn nothing.
 *
 * This gate rejects a document that contains NO tax-or-employment vocabulary at
 * all. It is deliberately coarse and deliberately generous: it decides only
 * whether a document is worth a model's attention, never whether it is
 * relevant. That judgement stays with the screen, which reads context rather
 * than counting words.
 *
 * THE RISK, STATED HONESTLY
 *
 * A keyword gate can produce false negatives — a genuinely relevant document
 * written in unusual language gets dropped with no AI call and no record of
 * being considered. Three things keep that acceptable:
 *
 *   1. The bar is one hit from a broad list, not a score. A tax document that
 *      mentions "tax" once passes.
 *   2. The list includes the generic terms every tax authority uses
 *      ("employer", "income", "payroll", "withholding"), not just mobility
 *      jargon — so an item does not need to be *about* mobility to pass, only
 *      about tax or employment.
 *   3. Rejections are counted and reported per run, so a gate that starts
 *      dropping too much is visible rather than silent.
 *
 * If the eval set in phase 7 shows this rejecting anything real, remove it —
 * the cost it saves is small, and the brief's relevance-accuracy metric matters
 * more than a few cents.
 */

/**
 * STRONG terms: one hit is enough.
 *
 * These are specific to tax and employment administration. A document
 * containing any of them is worth a model's attention.
 */
const STRONG = [
  'taxation', 'taxable', 'tax year', 'income tax', 'tax return', 'tax authority',
  'payroll', 'withhold', 'withholding', 'paye', 'remuneration',
  'employer', 'employee', 'employment income', 'wage', 'salary',
  'tax residen', // covers "tax resident", "tax residence", "tax residency"
  'non-resident', 'nonresident', 'expatriate', 'assignee', 'secondment',
  'cross-border', 'tax treaty', 'double taxation', 'permanent establishment',
  'social security', 'social insurance', 'national insurance', 'totalization',
  'business visitor', 'business traveller', 'business traveler',
  'remote work', 'telework', 'share option', 'stock option',
  'shadow payroll', 'tax equalisation', 'tax equalization',
] as const

/**
 * WEAK terms: three or more needed.
 *
 * These are ordinary English that happens to appear in tax writing. A live run
 * proved why they cannot stand alone: "Secretary of State participates in the
 * 81st United Nations General Assembly" passed the gate on "return" and
 * "declaration", and a New Brunswick infrastructure announcement passed on
 * "tax" and "resident" — residents of a province, not tax residents.
 *
 * Requiring three co-occurring weak terms keeps the gate generous toward a
 * genuine tax document written in unusual language, while rejecting prose that
 * merely shares vocabulary with one.
 */
const WEAK = [
  'tax', 'revenue', 'levy', 'duty', 'resident', 'residence',
  'return', 'filing', 'declaration', 'relief', 'allowance', 'deduction',
  'contribution', 'pension', 'equity', 'compensation', 'assignment',
] as const

const WEAK_THRESHOLD = 3

export type PrefilterResult = {
  passed: boolean
  /** Which terms hit, for diagnosing a surprising rejection. */
  matched: string[]
  reason: 'strong_term' | 'weak_terms' | 'no_match'
}

export function prefilter(input: { title: string | null; text: string }): PrefilterResult {
  const haystack = `${input.title ?? ''}\n${input.text}`.toLowerCase()

  const strongHits = STRONG.filter((term) => contains(haystack, term))
  if (strongHits.length > 0) {
    return { passed: true, matched: strongHits.slice(0, 5), reason: 'strong_term' }
  }

  const weakHits = WEAK.filter((term) => contains(haystack, term))
  if (weakHits.length >= WEAK_THRESHOLD) {
    return { passed: true, matched: weakHits.slice(0, 5), reason: 'weak_terms' }
  }

  return { passed: false, matched: weakHits, reason: 'no_match' }
}

/**
 * Leading word boundary only, so a term matches its own plural and common
 * suffixes ("employer" → "employers", "withhold" → "withholding") without
 * needing every form listed. No trailing boundary is deliberate: a trailing
 * `\b` would make "employer" miss "employer's".
 */
function contains(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}`).test(haystack)
}
