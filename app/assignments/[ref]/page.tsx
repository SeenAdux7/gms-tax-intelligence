import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import {
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_TYPE_LABELS,
  COMPLIANCE_STATUS_LABELS,
  MATCH_REASON_LABELS,
  getAssignment,
} from '../../lib/assignment-queries'
import { MATCH_DISCLAIMER } from '../../lib/matching'
import { formatDate, relativeToNow, shortJurisdiction } from '../../lib/labels'
import { StatusBadge } from '../../components/ui'

export const dynamic = 'force-dynamic'

export async function generateMetadata(props: PageProps<'/assignments/[ref]'>): Promise<Metadata> {
  const { ref } = await props.params
  return { title: `Assignment ${ref}` }
}

export default async function AssignmentPage(props: PageProps<'/assignments/[ref]'>) {
  const { ref } = await props.params
  const assignment = await getAssignment(ref)
  if (!assignment) notFound()

  const status = ASSIGNMENT_STATUS_LABELS[assignment.status]

  return (
    <main className="flex-1 pb-8">
      <div className="px-4 pt-4">
        <Link href="/assignments" className="text-[13px] font-medium text-accent hover:underline">
          ← Assignments
        </Link>
      </div>

      <header className="px-4 pt-3 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${status.className}`}>
            {status.label}
          </span>
          <span className="rounded border border-dashed border-line px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted uppercase">
            Synthetic
          </span>
        </div>

        <h1 className="mt-2 font-mono text-2xl font-semibold tracking-tight">
          {assignment.employeeRef}
        </h1>
        <p className="mt-1 text-[15px] font-medium">
          {shortJurisdiction(assignment.homeJurisdiction)}
          <span className="mx-1.5 text-muted">→</span>
          {shortJurisdiction(assignment.hostJurisdiction)}
        </p>
        <p className="mt-0.5 text-[13px] text-muted">
          {ASSIGNMENT_TYPE_LABELS[assignment.type] ?? assignment.type}
        </p>
      </header>

      {/* --- the record ------------------------------------------------- */}
      <section className="px-4 pb-6">
        <h2 className="mb-2 text-[13px] font-semibold">Assignment record</h2>
        <dl className="rounded-xl border border-line bg-surface-raised px-4">
          <Row label="Home location" value={shortJurisdiction(assignment.homeJurisdiction)} />
          <Row label="Host location" value={shortJurisdiction(assignment.hostJurisdiction)} />
          <Row label="Starts" value={formatDate(assignment.startDate) ?? '—'} />
          <Row
            label="Ends"
            value={assignment.endDate ? (formatDate(assignment.endDate) ?? '—') : 'Open-ended'}
          />
          <Row
            label="Payroll run from"
            value={assignment.payrollLocations.map(shortJurisdiction).join(', ') || '—'}
            /* Worth calling out: payroll outside the host country is the
               shadow-payroll situation most payroll developments land on. */
            note={
              !assignment.payrollLocations.includes(assignment.hostJurisdiction)
                ? `No payroll registered in ${shortJurisdiction(assignment.hostJurisdiction)}.`
                : undefined
            }
          />
          <Row
            label="Compensation"
            value={assignment.compensationCategories.map(humanise).join(', ') || '—'}
          />
          <Row label="Benefits" value={assignment.benefits.map(humanise).join(', ') || 'None recorded'} />
        </dl>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          No salary figures are stored. This version identifies records that may need review; it
          does not calculate tax.
        </p>
      </section>

      {/* --- compliance ------------------------------------------------- */}
      {assignment.deadlines.length > 0 && (
        <section className="px-4 pb-6">
          <h2 className="mb-2 text-[13px] font-semibold">Compliance items</h2>
          <ul className="space-y-2">
            {assignment.deadlines.map((deadline) => {
              const meta = COMPLIANCE_STATUS_LABELS[deadline.status]
              return (
                <li
                  key={`${deadline.label}-${deadline.dueDate}`}
                  className="rounded-xl border border-line bg-surface-raised px-4 py-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[13px] leading-snug font-medium">{deadline.label}</p>
                    <span className={`shrink-0 text-[10px] font-medium ${meta.className}`}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted">
                    Due {formatDate(deadline.dueDate)}
                    {deadline.status !== 'completed' && <> · {relativeToNow(deadline.dueDate)}</>}
                  </p>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* --- matches ----------------------------------------------------
          The heart of this screen. Each match carries its own explanation, and
          the disclaimer sits above rather than below — a reader who stops after
          the first item should already have read it. */}
      <section className="px-4">
        <h2 className="mb-1 text-[13px] font-semibold">
          {assignment.matches.length === 0
            ? 'No developments flagged'
            : `${assignment.matches.length} potential review ${assignment.matches.length === 1 ? 'item' : 'items'}`}
        </h2>

        {assignment.matches.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-muted">
            Nothing in the current feed shares a jurisdiction with this assignment. That is a
            statement about what we monitor, not an assurance that nothing applies.
          </p>
        ) : (
          <>
            <p className="mb-3 text-[12px] leading-relaxed text-muted">{MATCH_DISCLAIMER}</p>
            <ul className="space-y-3">
              {assignment.matches.map((match) => (
                <li
                  key={match.developmentSlug}
                  className="rounded-xl border border-line bg-surface-raised p-4"
                >
                  <div className="mb-2">
                    <StatusBadge status={match.status} size="sm" />
                  </div>
                  <Link
                    href={`/updates/${match.developmentSlug}`}
                    className="text-[14px] leading-snug font-semibold text-accent hover:underline"
                  >
                    {match.headline}
                  </Link>

                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {match.reasons.map((reason) => (
                      <span
                        key={reason}
                        className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted ring-1 ring-line"
                      >
                        {MATCH_REASON_LABELS[reason]}
                      </span>
                    ))}
                  </div>

                  <p className="mt-2.5 text-[12px] leading-relaxed whitespace-pre-line text-foreground/85">
                    {match.explanation}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  )
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-b border-line py-3 last:border-b-0">
      <dt className="text-[11px] font-semibold tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
      {note && <p className="mt-1 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">{note}</p>}
    </div>
  )
}

/** 'base_salary' -> 'Base salary'. */
function humanise(value: string): string {
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
