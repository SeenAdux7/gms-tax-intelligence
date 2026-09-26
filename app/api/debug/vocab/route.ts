import { NextResponse } from 'next/server'
import { db } from '@/db'
import { savedItems, termReviewState } from '@/db/schema'

/**
 * Development-only: the current saved/difficulty flags and review schedule.
 *
 * Exists so `scripts/verify-vocab.ts` can assert what actually landed in the
 * database rather than only what the UI claimed. The interesting assertions are
 * about the schedule — that a correct answer pushes a term further out and a
 * wrong one brings it back tomorrow — and those are invisible from the page.
 *
 * 404s outside development. The guard is the first thing in each handler rather
 * than a deployment concern, because a debug endpoint that quietly ships is how
 * a convenience becomes a leak.
 */
function guard() {
  return process.env.NODE_ENV !== 'development'
}

export async function GET() {
  if (guard()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [saved, review] = await Promise.all([
    db
      .select({
        entityType: savedItems.entityType,
        bookmarked: savedItems.bookmarked,
        markedDifficult: savedItems.markedDifficult,
      })
      .from(savedItems),
    db
      .select({
        termId: termReviewState.termId,
        correctStreak: termReviewState.correctStreak,
        incorrectCount: termReviewState.incorrectCount,
        dueAt: termReviewState.dueAt,
      })
      .from(termReviewState),
  ])

  const now = Date.now()

  return NextResponse.json({
    bookmarkedDevelopments: saved.filter((s) => s.entityType === 'development' && s.bookmarked)
      .length,
    bookmarkedTerms: saved.filter((s) => s.entityType === 'vocab_term' && s.bookmarked).length,
    difficultTerms: saved.filter((s) => s.markedDifficult).length,
    reviewRows: review.length,
    // Days until due, rounded — enough to tell a 1-day reset from a 1-day+
    // advance without asserting on exact timestamps.
    schedule: review.map((r) => ({
      correctStreak: r.correctStreak,
      incorrectCount: r.incorrectCount,
      daysUntilDue: r.dueAt ? Math.round((r.dueAt.getTime() - now) / 86_400_000) : null,
    })),
  })
}

export async function DELETE() {
  if (guard()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.delete(savedItems)
  await db.delete(termReviewState)
  return NextResponse.json({ cleared: true })
}
