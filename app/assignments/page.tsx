import Link from 'next/link'
import type { Metadata } from 'next'
import {
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_TYPE_LABELS,
  COMPLIANCE_STATUS_LABELS,
  listAssignments,
} from '../lib/assignment-queries'
import { formatDate, relativeToNow, shortJurisdiction } from '../lib/labels'
import { EmptyState } from '../components/ui'

export const metadata: Metadata = { title: 'Assignments' }
export const dynamic = 'force-dynamic'

/**
 * The synthetic assignment population.
 *
 * The "clearly labelled synthetic data" requirement is taken literally: there
 * is a permanent banner at the top, and the label is not dismissible. This
 * screen looks the most like a real HR system of anything in the app, which is
 * exactly why it needs to be unmistakable that nobody here exists.
 */
export default async function AssignmentsPage() {
  const population = await listAssignments()

  return (
    <main className="flex-1 pb-8">
      <header className="px-4 pt-6 pb-3">
        <h1 className="text-2xl font-semibold tracking-tight">Assignments</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          A fictional mobile workforce, used to show how a development connects to real records.
        </p>
      </header>

      <div className="px-4 pb-5">
        <div className="rounded-lg bg-fuchsia-500/10 px-3 py-2.5 text-[12px] leading-relaxed text-fuchsia-900 ring-1 ring-fuchsia-500/25 dark:text-fuchsia-200">
          <strong className="font-semibold">Entirely invented.</strong> These employees, companies,
          and assignments do not exist. This version of the app stores synthetic assignment data
          only — no real employee or client information is used anywhere.
        </div>
      </div>

      {population.length === 0 ? (
        <EmptyState title="No assignments loaded">
          Run <code>npm run db:seed:assignments</code> then <code>npm run db:match</code>.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {population.map((assignment) => {
            const status = ASSIGNMENT_STATUS_LABELS[assignment.status]
            return (
              <li key={assignment.employeeRef}>
                <Link
                  href={`/assignments/${assignment.employeeRef}`}
                  className="block px-4 py-4 transition-colors hover:bg-surface active:bg-surface"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-mono text-[14px] font-semibold">{assignment.employeeRef}</p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${status.className}`}
                    >
                      {status.label}
                    </span>
                  </div>

                  <p className="mt-1.5 text-[14px] font-medium">
                    {shortJurisdiction(assignment.homeJurisdiction)}
                    <span className="mx-1.5 text-muted">→</span>
                    {shortJurisdiction(assignment.hostJurisdiction)}
                  </p>

                  <p className="mt-0.5 text-[12px] text-muted">
                    {ASSIGNMENT_TYPE_LABELS[assignment.type] ?? assignment.type} ·{' '}
                    {formatDate(assignment.startDate)}
                    {assignment.endDate ? ` – ${formatDate(assignment.endDate)}` : ' – open-ended'}
                  </p>

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                    {assignment.matchCount > 0 ? (
                      <span className="font-medium text-accent">
                        {assignment.matchCount} potential review{' '}
                        {assignment.matchCount === 1 ? 'item' : 'items'}
                      </span>
                    ) : (
                      <span className="text-muted">No developments flagged</span>
                    )}

                    {assignment.nextDeadline && (
                      <span className={COMPLIANCE_STATUS_LABELS[assignment.nextDeadline.status].className}>
                        Next: {assignment.nextDeadline.label} ·{' '}
                        {relativeToNow(assignment.nextDeadline.dueDate)}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <p className="px-4 pt-5 text-[11px] leading-relaxed text-muted">
        &ldquo;Potential review items&rdquo; means a development shares a jurisdiction, employee
        type, date range, or issue with this assignment. It does not mean anything applies — that is
        a judgement for a professional.
      </p>
    </main>
  )
}
