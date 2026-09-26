/**
 * Saved tab queries
 * =================
 *
 * "Bookmarked updates, difficult terms, incorrect answers, and items selected
 * for later review."
 *
 * Four separate groups rather than one merged list, because they are things a
 * learner returns to for different reasons: a bookmarked update is "read this
 * properly later", a difficult term is "I keep forgetting this", and a wrong
 * answer is "I reasoned about this badly". Flattening them would lose that.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  developments,
  lessonOptions,
  lessonQuestions,
  lessons,
  questionAttempts,
  savedItems,
  termReviewState,
  vocabTerms,
} from '@/db/schema'
import { isDue, strengthOf } from './spaced-repetition'
import type { DevelopmentStatus } from './labels'

const LOCAL_USER = 'local'

export type SavedUpdate = {
  slug: string
  headline: string
  status: DevelopmentStatus | null
  savedAt: Date
}

export type SavedTerm = {
  slug: string
  term: string
  definition: string
  markedDifficult: boolean
  bookmarked: boolean
  strength: 'new' | 'learning' | 'known'
}

export type MissedQuestion = {
  developmentSlug: string
  headline: string
  prompt: string
  /** The answer that was actually correct. */
  correctLabel: string
  attemptedAt: Date
}

export async function getSavedUpdates(): Promise<SavedUpdate[]> {
  const rows = await db
    .select({
      slug: developments.slug,
      headline: developments.headline,
      status: developments.status,
      savedAt: savedItems.savedAt,
    })
    .from(savedItems)
    .innerJoin(developments, eq(savedItems.entityId, developments.id))
    .where(
      and(
        eq(savedItems.userId, LOCAL_USER),
        eq(savedItems.entityType, 'development'),
        eq(savedItems.bookmarked, true),
      ),
    )
    .orderBy(desc(savedItems.savedAt))

  return rows.map((r) => ({ ...r, status: r.status as DevelopmentStatus | null }))
}

/** Saved and/or difficult terms. Both flags are returned so the UI can say
 *  which reason put each term here. */
export async function getSavedTerms(): Promise<SavedTerm[]> {
  const rows = await db
    .select({
      slug: vocabTerms.slug,
      term: vocabTerms.term,
      definition: vocabTerms.definition,
      bookmarked: savedItems.bookmarked,
      markedDifficult: savedItems.markedDifficult,
      correctStreak: termReviewState.correctStreak,
      incorrectCount: termReviewState.incorrectCount,
      dueAt: termReviewState.dueAt,
      lastSeenAt: termReviewState.lastSeenAt,
    })
    .from(savedItems)
    .innerJoin(vocabTerms, eq(savedItems.entityId, vocabTerms.id))
    .leftJoin(
      termReviewState,
      and(eq(termReviewState.termId, vocabTerms.id), eq(termReviewState.userId, LOCAL_USER)),
    )
    .where(and(eq(savedItems.userId, LOCAL_USER), eq(savedItems.entityType, 'vocab_term')))
    .orderBy(desc(savedItems.savedAt))

  return rows.map((r) => ({
    slug: r.slug,
    term: r.term,
    definition: r.definition,
    bookmarked: r.bookmarked,
    markedDifficult: r.markedDifficult,
    strength: strengthOf({
      correctStreak: r.correctStreak ?? 0,
      incorrectCount: r.incorrectCount ?? 0,
      dueAt: r.dueAt,
      lastSeenAt: r.lastSeenAt,
    }),
  }))
}

/**
 * Lesson questions answered incorrectly.
 *
 * Only the MOST RECENT attempt per question counts. Showing a question you got
 * wrong in March and have since answered correctly twice would make the review
 * list grow forever and stop reflecting what you currently misunderstand.
 */
export async function getMissedQuestions(): Promise<MissedQuestion[]> {
  const latestAttempts = await db
    .select({
      questionId: questionAttempts.questionId,
      wasCorrect: questionAttempts.wasCorrect,
      attemptedAt: questionAttempts.attemptedAt,
      rank: sql<number>`row_number() over (
        partition by ${questionAttempts.questionId}
        order by ${questionAttempts.attemptedAt} desc
      )`,
    })
    .from(questionAttempts)
    .where(eq(questionAttempts.userId, LOCAL_USER))

  const missed = latestAttempts.filter((a) => Number(a.rank) === 1 && !a.wasCorrect)
  if (missed.length === 0) return []

  const questionIds = missed.map((m) => m.questionId)

  const rows = await db
    .select({
      questionId: lessonQuestions.id,
      prompt: lessonQuestions.prompt,
      developmentSlug: developments.slug,
      headline: developments.headline,
      correctLabel: lessonOptions.label,
    })
    .from(lessonQuestions)
    .innerJoin(lessons, eq(lessonQuestions.lessonId, lessons.id))
    .innerJoin(developments, eq(lessons.developmentId, developments.id))
    .innerJoin(
      lessonOptions,
      and(eq(lessonOptions.questionId, lessonQuestions.id), eq(lessonOptions.isCorrect, true)),
    )
    .where(inArray(lessonQuestions.id, questionIds))

  const attemptedById = new Map(missed.map((m) => [m.questionId, m.attemptedAt]))

  return rows
    .map((r) => ({
      developmentSlug: r.developmentSlug,
      headline: r.headline,
      prompt: r.prompt,
      correctLabel: r.correctLabel,
      attemptedAt: attemptedById.get(r.questionId)!,
    }))
    .sort((a, b) => b.attemptedAt.getTime() - a.attemptedAt.getTime())
}

/** Count of terms currently due or flagged, for the Saved tab's review prompt. */
export async function getReviewDueCount(): Promise<number> {
  const rows = await db
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
  return rows.filter((r) => {
    const state =
      r.correctStreak === null && r.incorrectCount === null && !r.dueAt
        ? null
        : {
            correctStreak: r.correctStreak ?? 0,
            incorrectCount: r.incorrectCount ?? 0,
            dueAt: r.dueAt,
            lastSeenAt: r.lastSeenAt,
          }
    return Boolean(r.markedDifficult) || (r.incorrectCount ?? 0) > 0 || isDue(state, now)
  }).length
}

/** Is this entity bookmarked? Used to set the initial state of a save button. */
export async function isSaved(
  entityType: 'development' | 'vocab_term',
  entityId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ bookmarked: savedItems.bookmarked })
    .from(savedItems)
    .where(
      and(
        eq(savedItems.userId, LOCAL_USER),
        eq(savedItems.entityType, entityType),
        eq(savedItems.entityId, entityId),
      ),
    )
  return Boolean(row?.bookmarked)
}
