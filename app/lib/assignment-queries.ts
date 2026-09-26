/**
 * Assignment and match queries
 * ============================
 *
 * Reads the precomputed matches from `db/compute-matches.ts`. Nothing here
 * re-runs the matcher — the stored explanation is the one the user was shown,
 * which is what makes a match auditable rather than merely plausible.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  assignmentDeadlines,
  assignments,
  developmentAssignmentMatches,
  developments,
} from '@/db/schema'
import type { DevelopmentStatus } from './labels'
import type { MatchReason } from './matching'

export type AssignmentSummary = {
  id: string
  employeeRef: string
  homeJurisdiction: string
  hostJurisdiction: string
  startDate: string
  endDate: string | null
  type: string
  status: 'planned' | 'active' | 'ended' | 'cancelled'
  payrollLocations: string[]
  /** How many developments flagged this assignment for review. */
  matchCount: number
  /** Deadlines not yet completed. */
  openDeadlines: number
  /** Soonest open deadline, for the list view. */
  nextDeadline: { label: string; dueDate: string; status: string } | null
}

export const ASSIGNMENT_TYPE_LABELS: Record<string, string> = {
  long_term: 'Long-term assignment',
  short_term: 'Short-term assignment',
  commuter: 'Commuter',
  business_traveler: 'Business traveller',
  remote_worker: 'Remote worker',
  domestic_transfer: 'Domestic transfer',
}

export const ASSIGNMENT_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  planned: {
    label: 'Planned',
    className: 'bg-blue-50 text-blue-800 ring-blue-300 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800',
  },
  active: {
    label: 'Active',
    className:
      'bg-emerald-50 text-emerald-800 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800',
  },
  ended: {
    label: 'Ended',
    className: 'bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-slate-100 text-slate-500 ring-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-600',
  },
}

export const COMPLIANCE_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  open: { label: 'Open', className: 'text-muted' },
  under_review: { label: 'Under review', className: 'text-blue-700 dark:text-blue-300' },
  completed: { label: 'Completed', className: 'text-emerald-700 dark:text-emerald-300' },
  overdue: { label: 'Overdue', className: 'text-red-700 dark:text-red-300' },
}

export async function listAssignments(): Promise<AssignmentSummary[]> {
  const rows = await db.select().from(assignments).orderBy(asc(assignments.employeeRef))
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)

  const [matchCounts, deadlineRows] = await Promise.all([
    db
      .select({
        assignmentId: developmentAssignmentMatches.assignmentId,
        count: sql<number>`count(*)::int`,
      })
      .from(developmentAssignmentMatches)
      .where(inArray(developmentAssignmentMatches.assignmentId, ids))
      .groupBy(developmentAssignmentMatches.assignmentId),
    db
      .select({
        assignmentId: assignmentDeadlines.assignmentId,
        label: assignmentDeadlines.label,
        dueDate: assignmentDeadlines.dueDate,
        status: assignmentDeadlines.status,
      })
      .from(assignmentDeadlines)
      .where(inArray(assignmentDeadlines.assignmentId, ids))
      .orderBy(asc(assignmentDeadlines.dueDate)),
  ])

  const countById = new Map(matchCounts.map((m) => [m.assignmentId, m.count]))

  const deadlinesById = deadlineRows.reduce<Map<string, typeof deadlineRows>>((map, d) => {
    map.set(d.assignmentId, [...(map.get(d.assignmentId) ?? []), d])
    return map
  }, new Map())

  return rows.map((row) => {
    const deadlines = deadlinesById.get(row.id) ?? []
    const open = deadlines.filter((d) => d.status !== 'completed')
    return {
      id: row.id,
      employeeRef: row.employeeRef,
      homeJurisdiction: row.homeJurisdiction,
      hostJurisdiction: row.hostJurisdiction,
      startDate: row.startDate,
      endDate: row.endDate,
      type: row.type,
      status: row.status,
      payrollLocations: row.payrollLocations,
      matchCount: countById.get(row.id) ?? 0,
      openDeadlines: open.length,
      // Already ordered by due date, so the first open one is the soonest.
      nextDeadline: open[0] ? { label: open[0].label, dueDate: open[0].dueDate, status: open[0].status } : null,
    }
  })
}

export type AssignmentDetail = AssignmentSummary & {
  compensationCategories: string[]
  benefits: string[]
  isSynthetic: boolean
  deadlines: { label: string; dueDate: string; status: string }[]
  matches: {
    developmentSlug: string
    headline: string
    status: DevelopmentStatus | null
    reasons: MatchReason[]
    explanation: string
    reviewStatus: string
  }[]
}

export async function getAssignment(employeeRef: string): Promise<AssignmentDetail | null> {
  const [row] = await db.select().from(assignments).where(eq(assignments.employeeRef, employeeRef))
  if (!row) return null

  const [deadlineRows, matchRows] = await Promise.all([
    db
      .select({
        label: assignmentDeadlines.label,
        dueDate: assignmentDeadlines.dueDate,
        status: assignmentDeadlines.status,
      })
      .from(assignmentDeadlines)
      .where(eq(assignmentDeadlines.assignmentId, row.id))
      .orderBy(asc(assignmentDeadlines.dueDate)),
    db
      .select({
        developmentSlug: developments.slug,
        headline: developments.headline,
        status: developments.status,
        reasons: developmentAssignmentMatches.reasons,
        explanation: developmentAssignmentMatches.explanation,
        reviewStatus: developmentAssignmentMatches.reviewStatus,
      })
      .from(developmentAssignmentMatches)
      .innerJoin(developments, eq(developmentAssignmentMatches.developmentId, developments.id))
      .where(eq(developmentAssignmentMatches.assignmentId, row.id)),
  ])

  const open = deadlineRows.filter((d) => d.status !== 'completed')

  return {
    id: row.id,
    employeeRef: row.employeeRef,
    homeJurisdiction: row.homeJurisdiction,
    hostJurisdiction: row.hostJurisdiction,
    startDate: row.startDate,
    endDate: row.endDate,
    type: row.type,
    status: row.status,
    payrollLocations: row.payrollLocations,
    compensationCategories: row.compensationCategories,
    benefits: row.benefits,
    isSynthetic: row.isSynthetic,
    matchCount: matchRows.length,
    openDeadlines: open.length,
    nextDeadline: open[0] ? { label: open[0].label, dueDate: open[0].dueDate, status: open[0].status } : null,
    deadlines: deadlineRows,
    matches: matchRows.map((m) => ({
      ...m,
      status: m.status as DevelopmentStatus | null,
      reasons: m.reasons as MatchReason[],
    })),
  }
}

/** Assignments a given development flagged for review, strongest first. */
export async function getMatchesForDevelopment(developmentSlug: string) {
  const rows = await db
    .select({
      employeeRef: assignments.employeeRef,
      homeJurisdiction: assignments.homeJurisdiction,
      hostJurisdiction: assignments.hostJurisdiction,
      type: assignments.type,
      status: assignments.status,
      reasons: developmentAssignmentMatches.reasons,
      explanation: developmentAssignmentMatches.explanation,
      reviewStatus: developmentAssignmentMatches.reviewStatus,
    })
    .from(developmentAssignmentMatches)
    .innerJoin(developments, eq(developmentAssignmentMatches.developmentId, developments.id))
    .innerJoin(assignments, eq(developmentAssignmentMatches.assignmentId, assignments.id))
    .where(eq(developments.slug, developmentSlug))
    .orderBy(asc(assignments.employeeRef))

  return rows
    .map((r) => ({ ...r, reasons: r.reasons as MatchReason[] }))
    // More reasons first — same ordering the matcher produces, reapplied here
    // because the stored rows carry reasons rather than a confidence column.
    .sort((a, b) => b.reasons.length - a.reasons.length || a.employeeRef.localeCompare(b.employeeRef))
}

export const MATCH_REASON_LABELS: Record<MatchReason, string> = {
  jurisdiction: 'Same place',
  population: 'Same employee type',
  date_range: 'Active on the effective date',
  topic: 'Relevant issue',
  payroll_location: 'Payroll location',
}

/** Counts for the dashboard in phase 5. */
export async function getAssignmentStats() {
  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${assignments.status} = 'active')::int`,
      planned: sql<number>`count(*) filter (where ${assignments.status} = 'planned')::int`,
    })
    .from(assignments)

  const [matches] = await db
    .select({
      total: sql<number>`count(*)::int`,
      affected: sql<number>`count(distinct ${developmentAssignmentMatches.assignmentId})::int`,
      open: sql<number>`count(*) filter (where ${developmentAssignmentMatches.reviewStatus} = 'open')::int`,
    })
    .from(developmentAssignmentMatches)

  const [deadlines] = await db
    .select({
      open: sql<number>`count(*) filter (where ${assignmentDeadlines.status} = 'open')::int`,
      overdue: sql<number>`count(*) filter (where ${assignmentDeadlines.status} = 'overdue')::int`,
      underReview: sql<number>`count(*) filter (where ${assignmentDeadlines.status} = 'under_review')::int`,
    })
    .from(assignmentDeadlines)

  return { assignments: totals, matches, deadlines }
}

/** Busiest corridors, for the dashboard. */
export async function getTopCorridors(limit = 5) {
  return db
    .select({
      home: assignments.homeJurisdiction,
      host: assignments.hostJurisdiction,
      count: sql<number>`count(*)::int`,
    })
    .from(assignments)
    .groupBy(assignments.homeJurisdiction, assignments.hostJurisdiction)
    .orderBy(sql`count(*) desc`)
    .limit(limit)
}

/**
 * Assignments with an unfinished deadline, soonest first.
 *
 * `status` is DERIVED: anything not completed whose due date has passed reads
 * as overdue, whatever the stored value says. Storing "overdue" as a column
 * value makes it a fact about when the row was last written rather than about
 * the deadline — the dashboard was showing an item 22 days past due as "Open"
 * because nothing had updated it since. A date comparison cannot go stale.
 */
export async function getUpcomingDeadlines(limit = 8) {
  return db
    .select({
      employeeRef: assignments.employeeRef,
      label: assignmentDeadlines.label,
      dueDate: assignmentDeadlines.dueDate,
      status: sql<string>`
        case
          when ${assignmentDeadlines.status} <> 'completed'
               and ${assignmentDeadlines.dueDate} < current_date
          then 'overdue'
          else ${assignmentDeadlines.status}
        end
      `,
    })
    .from(assignmentDeadlines)
    .innerJoin(assignments, eq(assignmentDeadlines.assignmentId, assignments.id))
    .where(and(sql`${assignmentDeadlines.status} <> 'completed'`))
    .orderBy(asc(assignmentDeadlines.dueDate))
    .limit(limit)
}
