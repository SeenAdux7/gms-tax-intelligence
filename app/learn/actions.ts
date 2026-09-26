'use server'

/**
 * Server actions for the lesson flow
 * ==================================
 *
 * Recording an attempt is a write, so it runs on the server. Whether an answer
 * was correct is NOT taken from the client — the client sends which option was
 * chosen, and the server looks up whether that option is the correct one. The
 * browser is not a trustworthy source for the thing being measured, and the
 * dashboard's accuracy metric is only worth showing if it cannot be tampered
 * with by accident.
 */

import { inArray } from 'drizzle-orm'
import { db } from '@/db'
import { lessonOptions, questionAttempts } from '@/db/schema'

export type AttemptInput = {
  questionId: string
  selectedOptionIds: string[]
  /** The client's view of correctness. Recorded for comparison but NOT trusted
   *  — the server recomputes it below. */
  wasCorrect: boolean
}

export async function recordAttempts(attempts: AttemptInput[]): Promise<{ saved: number }> {
  if (attempts.length === 0) return { saved: 0 }

  const chosenIds = attempts.flatMap((a) => a.selectedOptionIds)
  if (chosenIds.length === 0) return { saved: 0 }

  // Authoritative correctness, straight from the database.
  const optionRows = await db
    .select({ id: lessonOptions.id, isCorrect: lessonOptions.isCorrect })
    .from(lessonOptions)
    .where(inArray(lessonOptions.id, chosenIds))

  const correctById = new Map(optionRows.map((o) => [o.id, o.isCorrect]))

  const rows = attempts
    // Drop anything referencing an option that does not exist.
    .filter((a) => a.selectedOptionIds.every((id) => correctById.has(id)))
    .map((a) => ({
      questionId: a.questionId,
      selectedOptionIds: a.selectedOptionIds,
      // For single-answer questions this is one option; select-all questions
      // (a later phase) require every chosen option to be correct.
      wasCorrect:
        a.selectedOptionIds.length > 0 &&
        a.selectedOptionIds.every((id) => correctById.get(id) === true),
    }))

  if (rows.length === 0) return { saved: 0 }

  await db.insert(questionAttempts).values(rows)
  return { saved: rows.length }
}
