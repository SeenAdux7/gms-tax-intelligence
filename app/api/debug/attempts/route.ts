import { NextResponse } from 'next/server'
import { db } from '@/db'
import { questionAttempts } from '@/db/schema'

/**
 * Development-only: how many question attempts have been recorded, and how many
 * the SERVER judged correct.
 *
 * Exists so `scripts/verify-lesson.ts` can assert that answering a lesson
 * actually persists, and — more importantly — that correctness is recomputed
 * server-side rather than taken from the browser. Without this, the test could
 * only confirm the UI said the right thing, not that the right thing was stored.
 *
 * Returns 404 outside development. A debug endpoint that quietly ships to
 * production is how a harmless helper becomes an information leak, so the guard
 * is the first thing in the handler rather than a deployment-time concern.
 */
export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const rows = await db
    .select({ wasCorrect: questionAttempts.wasCorrect })
    .from(questionAttempts)

  return NextResponse.json({
    count: rows.length,
    correct: rows.filter((r) => r.wasCorrect).length,
  })
}

/**
 * Clears recorded attempts, so a verification run starts from a known state.
 *
 * Without this the counts accumulate across runs and an assertion like
 * "1 of 2 correct" silently becomes meaningless on the second run — which is
 * exactly what happened the first time this test was written.
 */
export async function DELETE() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await db.delete(questionAttempts)
  return NextResponse.json({ cleared: true })
}
