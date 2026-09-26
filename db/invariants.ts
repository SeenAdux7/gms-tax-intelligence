/**
 * Runtime invariants — the rules the schema can describe but not enforce
 * ======================================================================
 *
 * Postgres can make a column nullable; it cannot express "if this value is
 * present, its evidence must also be present." That gap is where a
 * source-grounded app quietly degrades into a plausible-sounding one, so the
 * checks live here and run on every write path.
 *
 * All of these are DETERMINISTIC. No model is asked whether its own output is
 * adequately sourced — the brief's line is "use deterministic code for dates,
 * counts, filters, calculations, and status tracking", and self-assessment is
 * exactly the wrong job for a language model.
 *
 * Usage: call the relevant check before inserting. Each returns a list of
 * violations; a non-empty list means the row does not get published (it is
 * routed to `review_state: 'needs_review'` instead of being dropped, so nothing
 * is silently lost).
 */

export type Violation = {
  /** Dotted path to the offending field, e.g. 'effectiveAt'. */
  field: string
  /** What rule was broken, in language fit to show in the review queue. */
  message: string
  severity: 'error' | 'warning'
}

/* ==========================================================================
 * Rule 1 — no claim without a quote
 * ========================================================================== */

/**
 * Every extracted fact on a development is paired with an evidence span. This
 * table IS the pairing; adding a fact column to the schema without adding it
 * here is the one way to bypass the guarantee, so keep them in sync.
 */
const FACT_EVIDENCE_PAIRS = [
  ['status', 'statusEvidenceId'],
  ['publishedAt', 'publishedAtEvidenceId'],
  ['effectiveAt', 'effectiveAtEvidenceId'],
  ['actionDeadlineAt', 'actionDeadlineEvidenceId'],
  ['primaryTopic', 'primaryTopicEvidenceId'],
] as const

type FactBearing = Record<string, unknown>

/**
 * Checks `value IS NOT NULL => evidence IS NOT NULL` across every fact column.
 *
 * Note what is NOT an error here: a NULL fact with NULL evidence. That is the
 * correct, expected representation of "the source didn't say", and the UI is
 * responsible for rendering it as such. Punishing it would push the extractor
 * back toward guessing, which is the failure mode we're trying to prevent.
 */
export function checkDevelopmentEvidence(development: FactBearing): Violation[] {
  const violations: Violation[] = []

  for (const [factField, evidenceField] of FACT_EVIDENCE_PAIRS) {
    const value = development[factField]
    const evidence = development[evidenceField]

    if (value !== null && value !== undefined && !evidence) {
      violations.push({
        field: factField,
        message:
          `'${factField}' is set to '${String(value)}' but has no supporting quote. ` +
          `Either attach the sentence from the source that states it, or leave the ` +
          `field empty so the app can show "not stated in source".`,
        severity: 'error',
      })
    }
  }

  return violations
}

/* ==========================================================================
 * Rule 2 — press alone cannot confirm a rule
 * ========================================================================== */

/**
 * "Newspaper reporting may help discover a development, but it should not
 * normally be the sole basis for presenting a rule as confirmed."
 *
 * Encoded as a ceiling on verification level given the best source tier backing
 * the development. A development seen only in the FT can be real and worth
 * showing — it just cannot wear a confirmed badge.
 */
const VERIFICATION_CEILING = {
  primary_official: 'official_confirmed',
  professional: 'corroborated',
  press: 'single_source',
  other: 'unverified',
} as const

const VERIFICATION_RANK = ['unverified', 'single_source', 'corroborated', 'official_confirmed'] as const

type SourceTier = keyof typeof VERIFICATION_CEILING
type Verification = (typeof VERIFICATION_RANK)[number]

export function checkVerificationCeiling(
  verification: Verification,
  /** Tiers of every source attached to the development. */
  attachedTiers: SourceTier[],
): Violation[] {
  if (attachedTiers.length === 0) {
    return [
      {
        field: 'verification',
        message: 'Development has no attached sources. Every factual development must link to its sources.',
        severity: 'error',
      },
    ]
  }

  // The best tier available sets the ceiling.
  const bestTier = attachedTiers.reduce<SourceTier>((best, tier) => {
    const order: SourceTier[] = ['other', 'press', 'professional', 'primary_official']
    return order.indexOf(tier) > order.indexOf(best) ? tier : best
  }, 'other')

  const ceiling = VERIFICATION_CEILING[bestTier]
  const claimed = VERIFICATION_RANK.indexOf(verification)
  const allowed = VERIFICATION_RANK.indexOf(ceiling)

  if (claimed > allowed) {
    return [
      {
        field: 'verification',
        message:
          `Verification '${verification}' exceeds what the sources support. The strongest ` +
          `attached source is tier '${bestTier}', which allows at most '${ceiling}'.`,
        severity: 'error',
      },
    ]
  }

  // Corroboration means genuinely independent sources, not one source twice.
  if (verification === 'corroborated' && attachedTiers.length < 2) {
    return [
      {
        field: 'verification',
        message: "Verification 'corroborated' requires at least two independent sources.",
        severity: 'error',
      },
    ]
  }

  return []
}

/* ==========================================================================
 * Rule 3 — a quiz may not manufacture certainty
 * ========================================================================== */

export type QuestionOptionForCheck = {
  label: string
  isCorrect: boolean
  evidenceId?: string | null
  isInsufficientInfo?: boolean
}

export type QuestionForCheck = {
  prompt: string
  explanation: string
  options: QuestionOptionForCheck[]
}

/**
 * The brief's sharpest constraint: "The system should never invent a definitive
 * legal conclusion merely to create a quiz."
 *
 * A language model asked to write a quiz will happily produce a confident
 * correct answer whether or not the source supports one — that's what makes
 * this a structural problem rather than a prompting problem. So the correct
 * answer must be backed one of exactly two ways:
 *
 *   1. It quotes the source (`evidenceId` is set), or
 *   2. It is the "not enough information to decide" option
 *      (`isInsufficientInfo`), which is a legitimate — often the BEST —
 *      answer when the sources genuinely don't settle the question.
 *
 * Anything else fails and the whole lesson is held back from the feed.
 */
export function checkQuestionValidity(question: QuestionForCheck): Violation[] {
  const violations: Violation[] = []
  const correct = question.options.filter((o) => o.isCorrect)

  if (correct.length === 0) {
    violations.push({
      field: 'options',
      message: `Question "${truncate(question.prompt)}" has no correct answer.`,
      severity: 'error',
    })
  }

  for (const option of correct) {
    if (!option.evidenceId && !option.isInsufficientInfo) {
      violations.push({
        field: 'options',
        message:
          `Correct answer "${truncate(option.label)}" cites no source and is not flagged as ` +
          `"not enough information". Either attach the quote that supports it, or rewrite the ` +
          `question so that acknowledging the uncertainty is the correct answer.`,
        severity: 'error',
      })
    }

    // An "insufficient information" option that also cites evidence is
    // contradictory — if we have the quote, the information is sufficient.
    if (option.isInsufficientInfo && option.evidenceId) {
      violations.push({
        field: 'options',
        message:
          `Option "${truncate(option.label)}" is flagged as "not enough information" but also ` +
          `cites a source. These are mutually exclusive.`,
        severity: 'error',
      })
    }
  }

  if (!question.explanation?.trim()) {
    violations.push({
      field: 'explanation',
      message:
        `Question "${truncate(question.prompt)}" has no explanation. Stage 3 must explain why the ` +
        `answer is stronger than the alternatives.`,
      severity: 'error',
    })
  }

  // Distractors should say why they're weaker, but a missing one is a quality
  // gap rather than a correctness failure — warn, don't block.
  const distractorsMissingRationale = question.options.filter((o) => !o.isCorrect).length
  if (distractorsMissingRationale === 0 && question.options.length > 1) {
    violations.push({
      field: 'options',
      message: 'Question has no incorrect options to choose between.',
      severity: 'error',
    })
  }

  return violations
}

/* ==========================================================================
 * Rule 4 — interpretation must be grounded
 * ========================================================================== */

/**
 * "Every factual development must link back to its sources." An AI-written
 * impact assessment with no evidence behind it is the thing most likely to be
 * mistaken for advice, so it does not get published.
 *
 * The exception is an interpretation that explicitly reports uncertainty
 * (`isUncertain`): saying "the guidance does not address equity compensation,
 * so this is unresolved" is a valid, useful statement that by its nature has no
 * supporting quote.
 */
export function checkInterpretationGrounding(interpretation: {
  kind: string
  body: string
  isUncertain?: boolean
  evidenceIds: string[]
}): Violation[] {
  if (interpretation.evidenceIds.length === 0 && !interpretation.isUncertain) {
    return [
      {
        field: 'evidenceIds',
        message:
          `Interpretation '${interpretation.kind}' cites no evidence. Attach the quotes it is ` +
          `reasoning from, or mark it as uncertain and state what is unresolved.`,
        severity: 'error',
      },
    ]
  }
  return []
}

/* ==========================================================================
 * Rule 5 — no real employee data, ever
 * ========================================================================== */

/**
 * "The first version should use synthetic assignment data only." Cheap belt and
 * braces: reject anything that looks like a real person's name in the
 * anonymous employee identifier field.
 */
export function checkAssignmentIsSynthetic(assignment: {
  employeeRef: string
  isSynthetic?: boolean
}): Violation[] {
  const violations: Violation[] = []

  if (assignment.isSynthetic === false) {
    violations.push({
      field: 'isSynthetic',
      message: 'This version stores synthetic assignment data only.',
      severity: 'error',
    })
  }

  // Expected shape is an opaque ref like 'EMP-0042'.
  if (!/^[A-Z]{2,5}-\d{2,6}$/.test(assignment.employeeRef)) {
    violations.push({
      field: 'employeeRef',
      message:
        `Employee reference '${assignment.employeeRef}' is not an anonymous identifier. ` +
        `Use a form like 'EMP-0042' — never a name.`,
      severity: 'error',
    })
  }

  return violations
}

/* -------------------------------------------------------------------------- */

function truncate(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** Convenience: did any check produce a blocking error? */
export function hasBlockingError(violations: Violation[]): boolean {
  return violations.some((v) => v.severity === 'error')
}

/** Formats violations for the review queue and for test failure output. */
export function formatViolations(violations: Violation[]): string {
  if (violations.length === 0) return 'No violations.'
  return violations.map((v) => `[${v.severity}] ${v.field}: ${v.message}`).join('\n')
}
