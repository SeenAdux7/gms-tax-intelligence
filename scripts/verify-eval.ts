/**
 * Unit tests for the evaluation scorer
 * ====================================
 *
 * No API key, no database, no network. The scorer has to be tested separately
 * from the pipeline it measures: a scorer that is itself wrong produces
 * confident numbers that are worse than no numbers, because they get believed.
 *
 * The cases that matter are the asymmetric ones. Getting a present date right
 * is easy to score; distinguishing "correctly said nothing was stated" from
 * "invented a date" from "missed a date that was there" is where a naive
 * exact-match scorer silently collapses three different behaviours into one.
 *
 * Run with:  npm run verify:eval
 */

import { scoreExtraction, type Expected } from '../pipeline/eval'
import type { FactsExtraction } from '../pipeline/ai'

const failures: string[] = []

function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
  }
}

const DOC =
  'The Internal Revenue Service has issued guidance describing how days of presence are counted. ' +
  'The guidance confirms that a day on which an employee performs any services within the United States is counted.'

const EXPECTED: Expected = {
  status: ['official_guidance'],
  // Abstention is the ONLY acceptable answer here - the document states no
  // effective date. This is the strict case the whole set exists for.
  effective_at: [null],
  primary_topic: ['tax_residency'],
  jurisdiction_codes: ['US'],
  populations: ['business_travelers', 'employers'],
}

/** A field where the reviewer accepted either a value or abstention. */
const EITHER_ACCEPTED: Expected = { ...EXPECTED, status: ['official_guidance', null] }

/** Builds a plausible extraction, overriding whichever fields a test needs. */
function extraction(overrides: Partial<{
  status: string | null
  statusQuote: string | null
  effectiveAt: string | null
  publishedAt: string | null
  primaryTopic: string | null
  jurisdictions: string[]
  jurisdictionQuote: string | null
  populations: string[]
}> = {}): FactsExtraction {
  const sourced = <T>(value: T | null, quote: string | null) => ({ value, quote })

  return {
    headline: 'US guidance on counting days of presence',
    status: sourced(
      overrides.status === undefined ? 'official_guidance' : overrides.status,
      overrides.statusQuote === undefined
        ? 'The Internal Revenue Service has issued guidance describing how days of presence are counted.'
        : overrides.statusQuote,
    ),
    published_at: sourced(
      overrides.publishedAt === undefined ? '2026-09-02' : overrides.publishedAt,
      'The Internal Revenue Service has issued guidance describing how days of presence are counted.',
    ),
    effective_at: sourced(
      overrides.effectiveAt === undefined ? null : overrides.effectiveAt,
      null,
    ),
    action_deadline_at: sourced(null, null),
    primary_topic: sourced(
      overrides.primaryTopic === undefined ? 'tax_residency' : overrides.primaryTopic,
      'The guidance confirms that a day on which an employee performs any services within the United States is counted.',
    ),
    jurisdictions: (overrides.jurisdictions ?? ['US']).map((code) => ({
      code,
      role: 'affected' as const,
      quote: overrides.jurisdictionQuote ?? null,
    })),
    topics: [],
    populations: (overrides.populations ?? ['business_travelers', 'employers']).map(
      (population) => ({ population: population as never, quote: null }),
    ),
    uncertainty_note: null,
  } as unknown as FactsExtraction
}

/* ==========================================================================
 * The perfect case
 * ========================================================================== */

console.log('\nBaseline:')

const perfect = scoreExtraction('t', EXPECTED, extraction(), DOC)
check('a fully correct extraction passes', perfect.passed, JSON.stringify(perfect.counts))
check(
  'the correctly-omitted effective date scores as an abstention, not a plain correct',
  perfect.counts.correct_abstention === 1,
  `abstentions=${perfect.counts.correct_abstention}`,
)
check('no fabrications', perfect.counts.fabricated === 0)
check('no unverifiable quotes', perfect.unverifiableQuotes === 0)

/* ==========================================================================
 * The three asymmetric null cases
 * ========================================================================== */

console.log('\nNull handling (the asymmetric cases):')

// Invented a date the source does not contain.
const fabricated = scoreExtraction('t', EXPECTED, extraction({ effectiveAt: '2026-09-02' }), DOC)
check(
  'inventing an absent date scores FABRICATED',
  fabricated.fields.find((f) => f.field === 'effective_at')?.verdict === 'fabricated',
)
check('a fabrication fails the sample', !fabricated.passed)
check(
  'a fabrication is counted separately from a wrong answer',
  fabricated.counts.fabricated === 1 && fabricated.counts.wrong === 0,
  'it must never hide inside a general accuracy percentage',
)

// Returned null where a value was genuinely present.
//
// Uses primary_topic, not published_at: published_at is no longer scored at
// all, so a test pointed at it would pass or fail for the wrong reason.
const missed = scoreExtraction('t', EXPECTED, extraction({ primaryTopic: null }), DOC)
check(
  'returning null where a value existed scores MISSED',
  missed.fields.find((f) => f.field === 'primary_topic')?.verdict === 'missed',
)
check(
  'a miss does NOT fail the sample',
  missed.passed,
  'it degrades to "not stated in source" — unhelpful, but not untrue',
)

// A plain wrong value.
const wrong = scoreExtraction('t', EXPECTED, extraction({ status: 'effective' }), DOC)
check(
  'a wrong value scores WRONG, not fabricated',
  wrong.fields.find((f) => f.field === 'status')?.verdict === 'wrong',
)
check('a wrong value fails the sample', !wrong.passed)

/* ==========================================================================
 * Set fields
 * ========================================================================== */

console.log('\nSet fields:')

const extraJurisdiction = scoreExtraction(
  't',
  EXPECTED,
  extraction({ jurisdictions: ['US', 'US-NY'] }),
  DOC,
)
check(
  'an EXTRA jurisdiction scores FABRICATED, not partially correct',
  extraJurisdiction.fields.find((f) => f.field === 'jurisdiction_codes')?.verdict === 'fabricated',
  'returning US-NY alongside US is the bug that made a New York item match 9 of 10 assignments',
)

const missingPopulation = scoreExtraction(
  't',
  EXPECTED,
  extraction({ populations: ['business_travelers'] }),
  DOC,
)
check(
  'a MISSING set member scores MISSED',
  missingPopulation.fields.find((f) => f.field === 'populations')?.verdict === 'missed',
)

const reordered = scoreExtraction(
  't',
  EXPECTED,
  extraction({ populations: ['employers', 'business_travelers'] }),
  DOC,
)
check(
  'set order does not affect the score',
  reordered.fields.find((f) => f.field === 'populations')?.verdict === 'correct',
)

const duplicated = scoreExtraction(
  't',
  EXPECTED,
  extraction({ jurisdictions: ['US', 'US'] }),
  DOC,
)
check(
  'a duplicated set member is not treated as an extra',
  duplicated.fields.find((f) => f.field === 'jurisdiction_codes')?.verdict === 'correct',
)

/* ==========================================================================
 * Evidence quality
 * ========================================================================== */

console.log('\nEvidence:')

// A stated status with NO quote at all is a miss: the value is unsupported.
const noQuote = scoreExtraction('t', EXPECTED, extraction({ statusQuote: null }), DOC)
check(
  'a stated status with no supporting quote scores MISSED on the quote',
  noQuote.fields.find((f) => f.field === 'status_quote')?.verdict === 'missed',
)

// A different but genuine sentence from the same document is acceptable. The
// scorer no longer demands the reviewer's exact choice of sentence - that
// tested recall of the test author, not whether the answer was evidenced.
const otherQuote = scoreExtraction(
  't',
  EXPECTED,
  extraction({
    statusQuote:
      'The guidance confirms that a day on which an employee performs any services within the United States is counted.',
  }),
  DOC,
)
check(
  'a different but verbatim supporting quote is accepted',
  otherQuote.fields.find((f) => f.field === 'status_quote')?.verdict === 'correct',
)

// A fact quote the model invented. Uses a jurisdiction quote because that is a
// field the FACTS pass returns — grounding_quotes moved to the writing pass
// when the schema was split, and a test pointed at a field the scorer no
// longer sees would pass for the wrong reason.
const hallucinatedQuote = scoreExtraction(
  't',
  EXPECTED,
  extraction({
    jurisdictionQuote: 'The guidance takes effect immediately for all employers nationwide.',
  }),
  DOC,
)
check(
  'a fact quote that is not in the document is counted as unverifiable',
  hallucinatedQuote.unverifiableQuotes === 1,
  `got ${hallucinatedQuote.unverifiableQuotes}`,
)


/* ==========================================================================
 * Acceptable-value lists
 * ========================================================================== */

console.log('\nAcceptable-value lists:')

check(
  'any value in the acceptable list scores correct',
  scoreExtraction(
    't',
    { ...EXPECTED, primary_topic: ['tax_residency', 'withholding'] },
    extraction({ primaryTopic: 'withholding' }),
    DOC,
  ).fields.find((f) => f.field === 'primary_topic')?.verdict === 'correct',
  'a second defensible reading must not be scored as wrong',
)

check(
  'a value outside the acceptable list still scores wrong',
  scoreExtraction(
    't',
    { ...EXPECTED, primary_topic: ['tax_residency', 'withholding'] },
    extraction({ primaryTopic: 'benefits' }),
    DOC,
  ).fields.find((f) => f.field === 'primary_topic')?.verdict === 'wrong',
)

check(
  'where null is ALSO acceptable, supplying the value is correct, not fabricated',
  scoreExtraction('t', EITHER_ACCEPTED, extraction({ status: 'official_guidance' }), DOC).fields.find(
    (f) => f.field === 'status',
  )?.verdict === 'correct',
  'this is the ca-discussion case: a discussion paper may be null or "discussion"',
)

check(
  'where null is also acceptable, abstaining is still an abstention',
  scoreExtraction('t', EITHER_ACCEPTED, extraction({ status: null }), DOC).fields.find(
    (f) => f.field === 'status',
  )?.verdict === 'correct_abstention',
)

check(
  'published_at is no longer scored at all',
  !scoreExtraction('t', EXPECTED, extraction(), DOC).fields.some((f) => f.field === 'published_at'),
  'it is not derivable from the document body - see db/seed-evals.ts',
)

/* -------------------------------------------------------------------------- */

console.log('')
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed.`)
  process.exit(1)
}
console.log('All eval scorer checks passed.')
