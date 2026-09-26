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
import type { Extraction } from '../pipeline/ai'

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
  status: 'official_guidance',
  effective_at: null, // the document states none
  published_at: '2026-09-02',
  primary_topic: 'tax_residency',
  jurisdiction_codes: ['US'],
  populations: ['business_travelers', 'employers'],
  status_quote_contains: 'has issued guidance',
}

/** Builds a plausible extraction, overriding whichever fields a test needs. */
function extraction(overrides: Partial<{
  status: string | null
  statusQuote: string | null
  effectiveAt: string | null
  publishedAt: string | null
  primaryTopic: string | null
  jurisdictions: string[]
  populations: string[]
  groundingQuotes: string[]
}> = {}): Extraction {
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
      quote: null,
    })),
    topics: [],
    populations: (overrides.populations ?? ['business_travelers', 'employers']).map(
      (population) => ({ population: population as never, quote: null }),
    ),
    uncertainty_note: null,
    learn_summary: 'x',
    professional_summary: 'x',
    employee_effect: 'x',
    employer_effect: 'x',
    gms_effect: 'x',
    review_actions: 'x',
    grounding_quotes:
      overrides.groundingQuotes ?? [
        'The guidance confirms that a day on which an employee performs any services within the United States is counted.',
      ],
    lesson_what_happened: 'x',
    lesson_apply_it: 'x',
    lesson_questions: [],
  } as unknown as Extraction
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
const missed = scoreExtraction('t', EXPECTED, extraction({ publishedAt: null }), DOC)
check(
  'returning null where a value existed scores MISSED',
  missed.fields.find((f) => f.field === 'published_at')?.verdict === 'missed',
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

const wrongQuote = scoreExtraction(
  't',
  EXPECTED,
  extraction({ statusQuote: 'The guidance confirms that a day on which an employee performs any services within the United States is counted.' }),
  DOC,
)
check(
  'a right answer with the wrong supporting quote scores WRONG on the quote',
  wrongQuote.fields.find((f) => f.field === 'status_quote')?.verdict === 'wrong',
  'a correct value backed by unrelated evidence is not a correct answer in this system',
)

const hallucinatedQuote = scoreExtraction(
  't',
  EXPECTED,
  extraction({
    groundingQuotes: ['The guidance takes effect immediately for all employers nationwide.'],
  }),
  DOC,
)
check(
  'a quote that is not in the document is counted as unverifiable',
  hallucinatedQuote.unverifiableQuotes === 1,
)

/* -------------------------------------------------------------------------- */

console.log('')
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed.`)
  process.exit(1)
}
console.log('All eval scorer checks passed.')
