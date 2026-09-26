'use server'

/**
 * Shared server actions: saving, marking difficult, recording term reviews
 * =======================================================================
 *
 * Single-user in v1 — "not required: a complex enterprise permissions system."
 * `LOCAL_USER` is the one identity, and it exists as a column value rather than
 * being hardcoded into queries so multi-user later is a migration, not a
 * rewrite.
 *
 * Scheduling decisions are made by `nextReviewState` in lib/spaced-repetition,
 * which is pure and testable. These functions only load current state, call it,
 * and persist the result.
 */

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { savedItems, termReviewState, vocabTerms } from '@/db/schema'
import { nextReviewState, type ReviewOutcome } from './lib/spaced-repetition'

const LOCAL_USER = 'local'

export type SavableType = 'development' | 'vocab_term'

/**
 * Toggles a bookmark.
 *
 * Returns the resulting state so the button can reflect reality rather than
 * assuming its optimistic guess was right.
 */
export async function toggleSaved(
  entityType: SavableType,
  entityId: string,
  /** Path to revalidate so the Saved tab and any list reflect the change. */
  revalidate?: string,
): Promise<{ saved: boolean }> {
  const [existing] = await db
    .select({
      id: savedItems.id,
      bookmarked: savedItems.bookmarked,
      markedDifficult: savedItems.markedDifficult,
    })
    .from(savedItems)
    .where(
      and(
        eq(savedItems.userId, LOCAL_USER),
        eq(savedItems.entityType, entityType),
        eq(savedItems.entityId, entityId),
      ),
    )

  let saved: boolean

  if (!existing) {
    await db.insert(savedItems).values({ userId: LOCAL_USER, entityType, entityId, bookmarked: true })
    saved = true
  } else {
    saved = !existing.bookmarked

    // Drop the row only when neither flag remains. Deleting it while a
    // difficulty flag is set would quietly remove the term from the review
    // queue, which is not what un-bookmarking means.
    if (!saved && !existing.markedDifficult) {
      await db.delete(savedItems).where(eq(savedItems.id, existing.id))
    } else {
      await db.update(savedItems).set({ bookmarked: saved }).where(eq(savedItems.id, existing.id))
    }
  }

  if (revalidate) revalidatePath(revalidate)
  revalidatePath('/saved')
  return { saved }
}

/**
 * Flags or unflags a term as difficult.
 *
 * Flagging also brings the term back into the review queue tomorrow — the brief
 * asks that difficult terms resurface, and a flag that changed nothing about
 * what you get asked would be decoration.
 */
export async function toggleDifficult(
  termId: string,
  revalidate?: string,
): Promise<{ markedDifficult: boolean }> {
  const [existing] = await db
    .select({
      id: savedItems.id,
      bookmarked: savedItems.bookmarked,
      markedDifficult: savedItems.markedDifficult,
    })
    .from(savedItems)
    .where(
      and(
        eq(savedItems.userId, LOCAL_USER),
        eq(savedItems.entityType, 'vocab_term'),
        eq(savedItems.entityId, termId),
      ),
    )

  const next = !existing?.markedDifficult

  if (!existing) {
    await db.insert(savedItems).values({
      userId: LOCAL_USER,
      entityType: 'vocab_term',
      entityId: termId,
      // Flagging difficult is not bookmarking. Keep them separate.
      bookmarked: false,
      markedDifficult: true,
    })
  } else if (!next && !existing.bookmarked) {
    // Both flags now false — the row carries no information.
    await db.delete(savedItems).where(eq(savedItems.id, existing.id))
  } else {
    await db.update(savedItems).set({ markedDifficult: next }).where(eq(savedItems.id, existing.id))
  }

  if (next) {
    await applyReviewOutcome(termId, 'marked_difficult')
  }

  if (revalidate) revalidatePath(revalidate)
  revalidatePath('/saved')
  revalidatePath('/vocabulary')
  return { markedDifficult: next }
}

/**
 * Records one practice answer and advances the term's schedule.
 *
 * `outcome` is derived from the answer the client submitted, but correctness is
 * NOT taken on trust — `recordPracticeAnswer` below resolves it against the
 * database. This function is the low-level write.
 */
async function applyReviewOutcome(termId: string, outcome: ReviewOutcome) {
  const [current] = await db
    .select({
      correctStreak: termReviewState.correctStreak,
      incorrectCount: termReviewState.incorrectCount,
      dueAt: termReviewState.dueAt,
      lastSeenAt: termReviewState.lastSeenAt,
    })
    .from(termReviewState)
    .where(and(eq(termReviewState.userId, LOCAL_USER), eq(termReviewState.termId, termId)))

  const next = nextReviewState(current ?? null, outcome)

  if (current) {
    await db
      .update(termReviewState)
      .set(next)
      .where(and(eq(termReviewState.userId, LOCAL_USER), eq(termReviewState.termId, termId)))
  } else {
    await db.insert(termReviewState).values({ userId: LOCAL_USER, termId, ...next })
  }
}

/**
 * One practice answer.
 *
 * The client sends which term it was asked about and which term it chose. The
 * server decides whether that was right, by comparing ids — the browser is not
 * a trustworthy source for the thing being measured, and this feeds both the
 * schedule and the dashboard's accuracy figure.
 */
export async function recordPracticeAnswer(input: {
  termId: string
  chosenTermId: string
}): Promise<{ correct: boolean }> {
  // Confirm both ids are real terms before writing anything.
  const rows = await db
    .select({ id: vocabTerms.id })
    .from(vocabTerms)
    .where(eq(vocabTerms.id, input.termId))

  if (rows.length === 0) return { correct: false }

  const correct = input.termId === input.chosenTermId
  await applyReviewOutcome(input.termId, correct ? 'correct' : 'incorrect')

  revalidatePath('/vocabulary')
  return { correct }
}
