/**
 * Shared presentation components
 * ==============================
 *
 * Two of these carry the product's core promises and are worth reading closely:
 *
 *   FactRow            — renders a fact WITH its quote, and renders the absence
 *                        of a fact as an explicit statement rather than a gap.
 *   InterpretationBlock — makes AI-written text unmistakable at a glance.
 *
 * Everything here is a server component. The evidence disclosures use native
 * <details>, so citations expand with no JavaScript at all — which also means
 * they work if the page is saved or printed.
 */

import Link from 'next/link'
import {
  INTERPRETATION_LABELS,
  STATUS_LABELS,
  STATUS_UNKNOWN,
  VERIFICATION_LABELS,
  formatDate,
  relativeToNow,
  shortJurisdiction,
  type DevelopmentStatus,
  type InterpretationKind,
  type VerificationLevel,
} from '../lib/labels'
import type { SourcedFact } from '../lib/queries'

/* ==========================================================================
 * Status
 * ========================================================================== */

export function StatusBadge({
  status,
  size = 'md',
}: {
  status: DevelopmentStatus | null
  size?: 'sm' | 'md'
}) {
  // A null status is not "no badge" — it is its own badge saying so. Hiding it
  // would let a reader assume a status they were never told.
  const meta = status ? STATUS_LABELS[status] : STATUS_UNKNOWN
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full ring-1 font-medium whitespace-nowrap ${pad} ${meta.className} ${
        status ? '' : 'ring-dashed'
      }`}
      title={meta.explain}
    >
      {!status && <span aria-hidden>?</span>}
      {meta.label}
    </span>
  )
}

export function VerificationBadge({ level }: { level: VerificationLevel }) {
  const meta = VERIFICATION_LABELS[level]
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${meta.className}`}
      title={meta.explain}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  )
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-surface px-2 py-0.5 text-[11px] font-medium text-muted ring-1 ring-line">
      {children}
    </span>
  )
}

export function JurisdictionChips({ codes }: { codes: string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {codes.map((code) => (
        <Chip key={code}>{shortJurisdiction(code)}</Chip>
      ))}
    </span>
  )
}

/* ==========================================================================
 * Evidence
 * ========================================================================== */

/**
 * A collapsed, verbatim quote from the source.
 *
 * The quote is displayed in quotation marks and monospace-adjacent styling to
 * signal "these are not our words". The link goes to the document it came from,
 * satisfying "every factual development must link back to its sources".
 */
export function EvidenceQuote({
  quote,
  sourceUrl,
  sourceTitle,
  publisher,
  label = 'Show the source',
}: {
  quote: string
  sourceUrl: string
  sourceTitle?: string | null
  publisher?: string | null
  label?: string
}) {
  return (
    <details className="group mt-1.5">
      <summary className="cursor-pointer list-none text-[11px] font-medium text-accent hover:underline">
        <span className="group-open:hidden">{label}</span>
        <span className="hidden group-open:inline">Hide source</span>
      </summary>
      <blockquote className="mt-2 border-l-2 border-accent/40 bg-surface py-2 pr-2 pl-3 text-[13px] leading-relaxed text-foreground/85">
        &ldquo;{quote}&rdquo;
        <footer className="mt-2 text-[11px] text-muted not-italic">
          {publisher && <span>{publisher} · </span>}
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            {sourceTitle ?? 'View source document'} ↗
          </a>
        </footer>
      </blockquote>
    </details>
  )
}

/* ==========================================================================
 * Facts
 * ========================================================================== */

/**
 * One labelled fact, with its supporting quote, or an explicit statement that
 * the source did not provide it.
 *
 * This component is where the brief's "do not silently fill missing dates,
 * jurisdictions, legal status, or affected populations" becomes visible to a
 * user. A blank field would be indistinguishable from a bug; a field that says
 * "Not stated in this source" is a finding — often a useful one, since a rule
 * with no announced effective date is itself something a GMS team needs to know.
 */
export function FactRow({
  label,
  fact,
  /** Renders the value; defaults to plain text. */
  render,
  /** Shown under the "not stated" line to explain why the absence matters. */
  absenceNote,
}: {
  label: string
  fact: SourcedFact<string> | SourcedFact<DevelopmentStatus>
  render?: (value: string) => React.ReactNode
  absenceNote?: string
}) {
  const hasValue = fact.value !== null && fact.value !== undefined

  return (
    <div className="border-b border-line py-3 last:border-b-0">
      <dt className="text-[11px] font-semibold tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-1">
        {hasValue ? (
          <>
            <div className="text-sm text-foreground">
              {render ? render(fact.value as string) : (fact.value as string)}
            </div>
            {fact.evidence && (
              <EvidenceQuote
                quote={fact.evidence.quote}
                sourceUrl={fact.evidence.sourceUrl}
                sourceTitle={fact.evidence.sourceTitle}
                publisher={fact.evidence.publisher}
              />
            )}
          </>
        ) : (
          <div>
            <div className="flex items-center gap-1.5 text-sm text-muted italic">
              <span aria-hidden>—</span>
              Not stated in this source
            </div>
            {absenceNote && <p className="mt-1 text-[12px] leading-relaxed text-muted">{absenceNote}</p>}
          </div>
        )}
      </dd>
    </div>
  )
}

/** A date fact, formatted, with a relative hint where it reads usefully. */
export function DateFactRow({
  label,
  fact,
  absenceNote,
  showRelative = false,
}: {
  label: string
  fact: SourcedFact<string>
  absenceNote?: string
  showRelative?: boolean
}) {
  return (
    <FactRow
      label={label}
      fact={fact}
      absenceNote={absenceNote}
      render={(value) => {
        const formatted = formatDate(value)
        const relative = showRelative ? relativeToNow(value) : null
        return (
          <span>
            {formatted}
            {relative && <span className="ml-2 text-muted">({relative})</span>}
          </span>
        )
      }}
    />
  )
}

/* ==========================================================================
 * Interpretation
 * ========================================================================== */

/**
 * A block of AI-written interpretation.
 *
 * The brief requires that "AI-generated interpretation must be visibly
 * distinguishable from source facts". Three things do that work here, and all
 * three are deliberate rather than decorative:
 *
 *   1. A tinted background and a solid left border, so the block reads as a
 *      distinct region rather than continuous body text.
 *   2. An explicit "Interpretation" tag on every single block — not once at the
 *      top of the page, where it would scroll away and stop applying.
 *   3. Hedged section headings ("Possible effect on...") that carry the
 *      uncertainty in the label itself.
 *
 * `isUncertain` blocks additionally get an amber treatment, because
 * "preserve uncertainty and conflicting information instead of forcing a single
 * conclusion" is only meaningful if the uncertainty is noticeable.
 */
export function InterpretationBlock({
  kind,
  body,
  model,
  isUncertain,
  editedByUser,
}: {
  kind: InterpretationKind
  body: string
  model?: string | null
  isUncertain?: boolean
  editedByUser?: boolean
}) {
  const tone = isUncertain
    ? 'border-l-amber-500 bg-amber-50/60 dark:bg-amber-950/25'
    : 'border-l-accent/50 bg-surface'

  return (
    <section className={`rounded-r-lg border-l-3 px-4 py-3 ${tone}`}>
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">{INTERPRETATION_LABELS[kind]}</h3>
        <span className="rounded bg-foreground/8 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted uppercase">
          {editedByUser ? 'Edited by you' : 'Interpretation'}
        </span>
        {isUncertain && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-300">
            Uncertain
          </span>
        )}
      </header>
      <p className="text-[14px] leading-relaxed whitespace-pre-line text-foreground/90">{body}</p>
      {model && <p className="mt-2 text-[10px] text-muted">Generated by {model}</p>}
    </section>
  )
}

/* ==========================================================================
 * Notices
 * ========================================================================== */

/**
 * Permanent educational-use disclaimer.
 *
 * "The app clearly states that its content is educational and informational,
 * not professional tax advice" is a completion criterion, so this sits in the
 * root layout and is not dismissible.
 */
export function AdviceDisclaimer() {
  return (
    <p className="px-4 py-2 text-center text-[11px] leading-snug text-muted">
      Educational and informational only. Not professional tax, legal, or immigration advice.
    </p>
  )
}

/** Marks hand-written demonstration content so it is never mistaken for a real
 *  collected development. Driven by the `isSeedData` column. */
export function SeedDataNotice({ inline = false }: { inline?: boolean }) {
  if (inline) {
    // Deliberately quiet. It appears on every card while the feed is entirely
    // seed data, so a loud badge would shout on every row and train the reader
    // to ignore it — which defeats the purpose once real items appear beside it.
    return (
      <span
        className="inline-flex items-center rounded border border-dashed border-line px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted uppercase"
        title="Illustrative content written for demonstration. Not a real published document."
      >
        Demo
      </span>
    )
  }
  return (
    <div className="rounded-lg bg-fuchsia-500/10 px-3 py-2 text-[12px] leading-relaxed text-fuchsia-900 ring-1 ring-fuchsia-500/25 dark:text-fuchsia-200">
      <strong className="font-semibold">Demonstration content.</strong> This development is
      illustrative — modelled on a real mechanism, but not a real published document. It exists so
      the app can be demonstrated when live sources are unavailable.
    </div>
  )
}

export function EmptyState({
  title,
  children,
}: {
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {children && <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-muted">{children}</p>}
    </div>
  )
}

/** Placeholder for sections that land in a later phase. Honest about what is
 *  and isn't built, rather than showing a broken screen. */
export function ComingSoon({
  section,
  phase,
  children,
}: {
  section: string
  phase: string
  children?: React.ReactNode
}) {
  return (
    <div className="px-6 py-16 text-center">
      <h1 className="text-lg font-semibold text-foreground">{section}</h1>
      <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-muted">
        {children ?? 'Not built yet.'}
      </p>
      <p className="mt-4 text-[11px] text-muted">Planned for {phase}</p>
      <Link
        href="/updates"
        className="mt-6 inline-block rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white"
      >
        Go to Updates
      </Link>
    </div>
  )
}
