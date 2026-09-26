/**
 * Dashboard queries
 * =================
 *
 * "The dashboard should present useful information without becoming a crowded
 * enterprise system."
 *
 * Every figure here is a COUNT or a DATE COMPARISON computed in SQL. Nothing on
 * this screen is generated or estimated — which matters more on a dashboard
 * than anywhere else in the app, because a number presented without a source
 * looks authoritative by default.
 */

import { and, asc, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  assignmentDeadlines,
  assignments,
  developmentAssignmentMatches,
  developmentJurisdictions,
  developmentTopics,
  developments,
  lessonQuestions,
  questionAttempts,
  savedItems,
  termReviewState,
  vocabTerms,
} from '@/db/schema'
import type { DevelopmentStatus, Topic } from './labels'
import { isDue, strengthOf } from './spaced-repetition'

const LOCAL_USER = 'local'

/* ==========================================================================
 * Current events
 * ========================================================================== */

export async function getDevelopmentCounts() {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      // "Proposed versus enacted or effective developments" — the brief asks
      // for this split specifically, because conflating them is the mistake.
      notYetLaw: sql<number>`count(*) filter (where ${developments.status} in ('discussion','proposed'))::int`,
      settled: sql<number>`count(*) filter (where ${developments.status} in ('enacted','official_guidance','effective'))::int`,
      statusUnknown: sql<number>`count(*) filter (where ${developments.status} is null)::int`,
      // Developments whose effective date the source never stated. Worth a
      // tile of its own: it is a real gap in what a team can plan around.
      noEffectiveDate: sql<number>`count(*) filter (where ${developments.effectiveAt} is null)::int`,
    })
    .from(developments)
    .where(eq(developments.reviewState, 'approved'))

  return row
}

/** Developments per jurisdiction, most active first. */
export async function getDevelopmentsByJurisdiction() {
  return db
    .select({
      code: developmentJurisdictions.jurisdictionCode,
      count: sql<number>`count(distinct ${developments.id})::int`,
    })
    .from(developmentJurisdictions)
    .innerJoin(developments, eq(developmentJurisdictions.developmentId, developments.id))
    .where(eq(developments.reviewState, 'approved'))
    .groupBy(developmentJurisdictions.jurisdictionCode)
    .orderBy(desc(sql`count(distinct ${developments.id})`))
}

/** Developments per topic, most active first. */
export async function getDevelopmentsByTopic() {
  const rows = await db
    .select({
      topic: developmentTopics.topic,
      count: sql<number>`count(distinct ${developments.id})::int`,
    })
    .from(developmentTopics)
    .innerJoin(developments, eq(developmentTopics.developmentId, developments.id))
    .where(eq(developments.reviewState, 'approved'))
    .groupBy(developmentTopics.topic)
    .orderBy(desc(sql`count(distinct ${developments.id})`))

  return rows.map((r) => ({ topic: r.topic as Topic, count: r.count }))
}

/**
 * Counts per lifecycle status, in lifecycle order.
 *
 * Returned in the fixed order discussion → effective rather than by size,
 * because the status scale is ORDINAL: the chart encodes it as a single-hue
 * ramp, and sorting by count would break the correspondence between position
 * and legal certainty.
 */
const STATUS_ORDER: DevelopmentStatus[] = [
  'discussion',
  'proposed',
  'enacted',
  'official_guidance',
  'effective',
]

export async function getDevelopmentsByStatus() {
  const rows = await db
    .select({ status: developments.status, count: sql<number>`count(*)::int` })
    .from(developments)
    .where(eq(developments.reviewState, 'approved'))
    .groupBy(developments.status)

  const byStatus = new Map(rows.map((r) => [r.status, r.count]))

  const ordered = STATUS_ORDER.map((status) => ({
    status,
    count: byStatus.get(status) ?? 0,
  }))

  return {
    ordered,
    unknown: byStatus.get(null) ?? 0,
    total: rows.reduce((sum, r) => sum + r.count, 0),
  }
}

/**
 * Upcoming effective dates.
 *
 * Only forward-looking rows, and only where a date exists. A development with
 * no stated effective date cannot appear in a timeline — it is counted
 * separately in `getDevelopmentCounts().noEffectiveDate` so the absence is
 * visible rather than silently dropped.
 */
export async function getUpcomingEffectiveDates(limit = 6) {
  const today = new Date().toISOString().slice(0, 10)

  const rows = await db
    .select({
      slug: developments.slug,
      headline: developments.headline,
      status: developments.status,
      effectiveAt: developments.effectiveAt,
    })
    .from(developments)
    .where(
      and(
        eq(developments.reviewState, 'approved'),
        sql`${developments.effectiveAt} is not null`,
        gte(developments.effectiveAt, today),
      ),
    )
    .orderBy(asc(developments.effectiveAt))
    .limit(limit)

  return rows.map((r) => ({ ...r, status: r.status as DevelopmentStatus | null }))
}

/* ==========================================================================
 * Learning progress
 * ========================================================================== */

export async function getLearningProgress() {
  const [questionTotals] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(lessonQuestions)

  const attempts = await db
    .select({
      questionId: questionAttempts.questionId,
      wasCorrect: questionAttempts.wasCorrect,
      attemptedAt: questionAttempts.attemptedAt,
    })
    .from(questionAttempts)
    .where(eq(questionAttempts.userId, LOCAL_USER))
    .orderBy(desc(questionAttempts.attemptedAt))

  // Latest attempt per question only. Counting every attempt would let a
  // question answered wrong then right drag the accuracy figure down forever,
  // which stops it describing what the learner currently knows.
  const latestByQuestion = new Map<string, boolean>()
  for (const attempt of attempts) {
    if (!latestByQuestion.has(attempt.questionId)) {
      latestByQuestion.set(attempt.questionId, attempt.wasCorrect)
    }
  }

  const answered = latestByQuestion.size
  const correct = [...latestByQuestion.values()].filter(Boolean).length

  /* --- vocabulary ---------------------------------------------------- */
  const termRows = await db
    .select({
      correctStreak: termReviewState.correctStreak,
      incorrectCount: termReviewState.incorrectCount,
      dueAt: termReviewState.dueAt,
      lastSeenAt: termReviewState.lastSeenAt,
      markedDifficult: savedItems.markedDifficult,
    })
    .from(vocabTerms)
    .leftJoin(
      termReviewState,
      and(eq(termReviewState.termId, vocabTerms.id), eq(termReviewState.userId, LOCAL_USER)),
    )
    .leftJoin(
      savedItems,
      and(
        eq(savedItems.entityId, vocabTerms.id),
        eq(savedItems.entityType, 'vocab_term'),
        eq(savedItems.userId, LOCAL_USER),
      ),
    )

  const now = new Date()
  let known = 0
  let learning = 0
  let notStarted = 0
  let needsReview = 0

  for (const row of termRows) {
    const state =
      row.correctStreak === null && row.incorrectCount === null && !row.dueAt
        ? null
        : {
            correctStreak: row.correctStreak ?? 0,
            incorrectCount: row.incorrectCount ?? 0,
            dueAt: row.dueAt,
            lastSeenAt: row.lastSeenAt,
          }

    const strength = strengthOf(state)
    if (strength === 'known') known += 1
    else if (strength === 'learning') learning += 1
    else notStarted += 1

    if (row.markedDifficult || (row.incorrectCount ?? 0) > 0 || isDue(state, now)) {
      needsReview += 1
    }
  }

  return {
    questions: {
      total: questionTotals?.total ?? 0,
      answered,
      correct,
      // Null rather than 0 when nothing has been answered. A 0% accuracy
      // reads as "you got everything wrong", which is not the same as
      // "you have not started".
      accuracy: answered > 0 ? correct / answered : null,
    },
    vocabulary: { total: termRows.length, known, learning, notStarted, needsReview },
  }
}

/** Lessons where the most recent attempt at any question was wrong. */
export async function getWeakestTopics(limit = 4) {
  const rows = await db
    .select({
      topic: developmentTopics.topic,
      wrong: sql<number>`count(*) filter (where ${questionAttempts.wasCorrect} = false)::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(questionAttempts)
    .innerJoin(lessonQuestions, eq(questionAttempts.questionId, lessonQuestions.id))
    .innerJoin(
      sql`lessons`,
      sql`lessons.id = ${lessonQuestions.lessonId}`,
    )
    .innerJoin(developmentTopics, sql`${developmentTopics.developmentId} = lessons.development_id`)
    .where(eq(questionAttempts.userId, LOCAL_USER))
    .groupBy(developmentTopics.topic)
    .orderBy(desc(sql`count(*) filter (where ${questionAttempts.wasCorrect} = false)`))
    .limit(limit)

  return rows
    .filter((r) => r.wrong > 0)
    .map((r) => ({ topic: r.topic as Topic, wrong: r.wrong, total: r.total }))
}

/* ==========================================================================
 * Compliance and the synthetic workforce
 * ========================================================================== */

export async function getComplianceSummary() {
  // Overdue is DERIVED from the due date, not read from the column. A stored
  // "overdue" is a fact about when the row was last touched; a date comparison
  // is a fact about the deadline. See getUpcomingDeadlines for the bug this
  // fixes — the dashboard showed an item 22 days past due as merely "open".
  const overdueCondition = sql`${assignmentDeadlines.status} <> 'completed' and ${assignmentDeadlines.dueDate} < current_date`

  const [deadlines] = await db
    .select({
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${assignmentDeadlines.status} = 'open' and not (${overdueCondition}))::int`,
      underReview: sql<number>`count(*) filter (where ${assignmentDeadlines.status} = 'under_review' and not (${overdueCondition}))::int`,
      completed: sql<number>`count(*) filter (where ${assignmentDeadlines.status} = 'completed')::int`,
      overdue: sql<number>`count(*) filter (where ${overdueCondition})::int`,
    })
    .from(assignmentDeadlines)

  const [population] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${assignments.status} = 'active')::int`,
      planned: sql<number>`count(*) filter (where ${assignments.status} = 'planned')::int`,
    })
    .from(assignments)

  const [matches] = await db
    .select({
      total: sql<number>`count(*)::int`,
      affectedAssignments: sql<number>`count(distinct ${developmentAssignmentMatches.assignmentId})::int`,
      open: sql<number>`count(*) filter (where ${developmentAssignmentMatches.reviewStatus} = 'open')::int`,
    })
    .from(developmentAssignmentMatches)

  return { deadlines, population, matches }
}

/** Review items grouped by the topic that raised them — the brief's "alerts by
 *  payroll, benefits, policy, residency, treaty, or filing category". */
export async function getAlertsByTopic() {
  const rows = await db
    .select({
      topic: developmentTopics.topic,
      count: sql<number>`count(distinct ${developmentAssignmentMatches.id})::int`,
    })
    .from(developmentAssignmentMatches)
    .innerJoin(
      developmentTopics,
      eq(developmentTopics.developmentId, developmentAssignmentMatches.developmentId),
    )
    .groupBy(developmentTopics.topic)
    .orderBy(desc(sql`count(distinct ${developmentAssignmentMatches.id})`))

  return rows.map((r) => ({ topic: r.topic as Topic, count: r.count }))
}
