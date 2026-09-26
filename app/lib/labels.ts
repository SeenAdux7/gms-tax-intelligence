/**
 * Display labels and styling for the controlled vocabularies
 * ==========================================================
 *
 * The database stores `official_guidance`; a beginner should read "Official
 * guidance" with a one-line explanation of what that actually means for them.
 * Keeping those strings here — rather than inline in components — means the
 * wording stays consistent everywhere and can be revised in one place.
 *
 * The `explain` fields exist because of the brief's first product principle:
 * "Beginner first. Explain unfamiliar language instead of assuming prior tax
 * knowledge." A status badge that only says "Enacted" teaches nothing.
 */

/* ==========================================================================
 * Legal status
 *
 * The brief: "Proposed measures, enacted laws, official guidance, and effective
 * rules must not be presented as the same thing." So each status gets its own
 * colour AND its own plain-language gloss, ordered to read as a progression
 * from "just talk" (grey) to "live now" (green).
 * ========================================================================== */

export type DevelopmentStatus =
  | 'discussion'
  | 'proposed'
  | 'enacted'
  | 'official_guidance'
  | 'effective'

export const STATUS_LABELS: Record<
  DevelopmentStatus,
  { label: string; explain: string; className: string }
> = {
  discussion: {
    label: 'Under discussion',
    explain: 'Being talked about. Nothing has been decided and nothing has changed.',
    className:
      'bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600',
  },
  proposed: {
    label: 'Proposed',
    explain: 'Formally put forward but not yet agreed. It may change or be dropped entirely.',
    className:
      'bg-amber-50 text-amber-800 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800',
  },
  enacted: {
    label: 'Passed into law',
    explain: 'Agreed and written into law — though it may not apply yet. Check the effective date.',
    className:
      'bg-blue-50 text-blue-800 ring-blue-300 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800',
  },
  official_guidance: {
    label: 'Official guidance',
    explain:
      'A tax authority explaining how it will apply existing rules. Not a new law, but it tells you what to expect.',
    className:
      'bg-violet-50 text-violet-800 ring-violet-300 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-800',
  },
  effective: {
    label: 'In effect now',
    explain: 'Live and applying today.',
    className:
      'bg-emerald-50 text-emerald-800 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800',
  },
}

/** Rendering for a status the source never stated. Visually distinct from every
 *  real status — unfilled and dashed — so it reads as an absence, not a value. */
export const STATUS_UNKNOWN = {
  label: 'Status not stated',
  explain:
    'The source does not make clear where this sits in the legal process. We have left it blank rather than guess.',
  className: 'bg-transparent text-muted ring-line',
}

/* ==========================================================================
 * Verification
 * ========================================================================== */

export type VerificationLevel =
  | 'unverified'
  | 'single_source'
  | 'corroborated'
  | 'official_confirmed'

export const VERIFICATION_LABELS: Record<
  VerificationLevel,
  { label: string; explain: string; className: string }
> = {
  unverified: {
    label: 'Unverified',
    explain: 'Not yet confirmed against a reliable source. Treat with caution.',
    className: 'text-slate-500 dark:text-slate-400',
  },
  single_source: {
    label: 'One source',
    explain: 'Reported by one credible source, not yet confirmed anywhere else.',
    className: 'text-amber-700 dark:text-amber-300',
  },
  corroborated: {
    label: 'Corroborated',
    explain: 'Two or more independent sources agree on this.',
    className: 'text-blue-700 dark:text-blue-300',
  },
  official_confirmed: {
    label: 'Officially confirmed',
    explain: 'Stated directly by the tax authority or government body itself.',
    className: 'text-emerald-700 dark:text-emerald-300',
  },
}

/* ==========================================================================
 * Topics
 * ========================================================================== */

export type Topic =
  | 'individual_income_tax'
  | 'tax_residency'
  | 'withholding'
  | 'payroll'
  | 'compensation'
  | 'benefits'
  | 'social_security'
  | 'tax_treaty'
  | 'reporting'
  | 'immigration_tax'
  | 'assignment_policy'

export const TOPIC_LABELS: Record<Topic, string> = {
  individual_income_tax: 'Income tax',
  tax_residency: 'Tax residency',
  withholding: 'Withholding',
  payroll: 'Payroll',
  compensation: 'Compensation',
  benefits: 'Benefits',
  social_security: 'Social security',
  tax_treaty: 'Tax treaty',
  reporting: 'Reporting',
  immigration_tax: 'Immigration & tax',
  assignment_policy: 'Assignment policy',
}

/* ==========================================================================
 * Affected populations
 * ========================================================================== */

export type AffectedPopulation =
  | 'expatriates'
  | 'business_travelers'
  | 'remote_workers'
  | 'domestic_state_workers'
  | 'employers'
  | 'other'

export const POPULATION_LABELS: Record<AffectedPopulation, string> = {
  expatriates: 'Expatriates',
  business_travelers: 'Business travellers',
  remote_workers: 'Remote workers',
  domestic_state_workers: 'US state-to-state workers',
  employers: 'Employers',
  other: 'Other',
}

/* ==========================================================================
 * AI interpretation sections
 *
 * Every one of these renders inside a visibly distinct, labelled block — see
 * components/InterpretationBlock.tsx — because the brief requires AI-generated
 * interpretation to be distinguishable from source facts at a glance.
 * ========================================================================== */

export type InterpretationKind =
  | 'learn_summary'
  | 'professional_summary'
  | 'employee_effect'
  | 'employer_effect'
  | 'gms_effect'
  | 'review_actions'
  | 'uncertainty'

export const INTERPRETATION_LABELS: Record<InterpretationKind, string> = {
  learn_summary: 'What happened',
  professional_summary: 'Regulatory summary',
  employee_effect: 'Possible effect on the employee',
  employer_effect: 'Possible effect on the employer',
  gms_effect: 'Possible effect on GMS work',
  review_actions: 'Possible review areas',
  uncertainty: 'What is still unknown',
}

/* ==========================================================================
 * Jurisdictions
 * ========================================================================== */

export const JURISDICTION_SHORT: Record<string, string> = {
  US: 'US',
  'US-NY': 'New York',
  'US-CA': 'California',
  GB: 'UK',
  IE: 'Ireland',
  CA: 'Canada',
  OECD: 'OECD',
}

export function shortJurisdiction(code: string): string {
  return JURISDICTION_SHORT[code] ?? code
}

/* ==========================================================================
 * Dates
 * ========================================================================== */

/**
 * Formats a date, or returns null when there is nothing to format.
 *
 * Callers must handle null by rendering an explicit "not stated" — see
 * components/FactRow.tsx. Returning a placeholder like '—' from here would let
 * a missing date slip through looking like a formatting quirk rather than the
 * meaningful absence it actually is.
 */
export function formatDate(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : value
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Relative phrasing for effective dates: "in 3 months", "2 weeks ago". */
export function relativeToNow(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : value
  if (Number.isNaN(date.getTime())) return null

  const days = Math.round((date.getTime() - Date.now()) / 86_400_000)
  const abs = Math.abs(days)

  if (abs === 0) return 'today'
  const [divisor, unit]: [number, Intl.RelativeTimeFormatUnit] =
    abs < 31 ? [1, 'day'] : abs < 365 ? [30, 'month'] : [365, 'year']

  return new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' }).format(
    Math.round(days / divisor),
    unit,
  )
}
