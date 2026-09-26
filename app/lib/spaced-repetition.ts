/**
 * Spaced repetition scheduling
 * ============================
 *
 * "Revisit incorrect answers and difficult terms. Bring weaker terms back more
 * frequently over time."
 *
 * Pure functions, no database, no model. Scheduling is arithmetic over dates
 * and counts, which is squarely on the deterministic side of the brief's line:
 * "use deterministic code for dates, counts, filters, calculations, and status
 * tracking."
 *
 * Kept separate from the queries so it can be unit tested without a database,
 * and so the intervals are visible in one place rather than scattered through
 * a server action.
 */

/**
 * Days until a term resurfaces, indexed by how many times it has been answered
 * correctly in a row.
 *
 * A simplified Leitner schedule. Deliberately not SM-2: that algorithm tunes
 * itself from a self-reported difficulty rating per card, and this app's
 * practice modes ask multiple-choice questions with no such rating. Inventing
 * a difficulty signal to feed a more sophisticated algorithm would make the
 * schedule look more scientific without making it more accurate.
 *
 * The first interval is 1 day rather than minutes: this is a tool someone opens
 * occasionally to learn a field, not a cramming app before an exam.
 */
const INTERVALS_DAYS = [1, 3, 7, 16, 35, 90] as const

/** Where a term sits in the schedule. */
export type ReviewState = {
  correctStreak: number
  incorrectCount: number
  dueAt: Date | null
  lastSeenAt: Date | null
}

export type ReviewOutcome = 'correct' | 'incorrect' | 'marked_difficult'

const DAY_MS = 86_400_000

/**
 * Advances a term's schedule after one answer.
 *
 * A wrong answer resets the streak to zero rather than stepping back one
 * level. If you have forgotten something, you have forgotten it — and the
 * gentler step-back tends to let a genuinely unknown term drift out to long
 * intervals on the strength of a few lucky guesses.
 *
 * `now` is injected rather than read from the clock so this is testable.
 */
export function nextReviewState(
  current: ReviewState | null,
  outcome: ReviewOutcome,
  now: Date = new Date(),
): ReviewState {
  const previous: ReviewState = current ?? {
    correctStreak: 0,
    incorrectCount: 0,
    dueAt: null,
    lastSeenAt: null,
  }

  if (outcome === 'correct') {
    const streak = previous.correctStreak + 1
    // Clamp to the last interval: a term answered right ten times running does
    // not need a five-year gap, it needs an annual-ish refresh.
    const days = INTERVALS_DAYS[Math.min(streak - 1, INTERVALS_DAYS.length - 1)]
    return {
      correctStreak: streak,
      incorrectCount: previous.incorrectCount,
      dueAt: new Date(now.getTime() + days * DAY_MS),
      lastSeenAt: now,
    }
  }

  if (outcome === 'incorrect') {
    return {
      correctStreak: 0,
      incorrectCount: previous.incorrectCount + 1,
      // Back tomorrow. Same day would mean re-answering from short-term memory,
      // which teaches recognition of the question rather than the term.
      dueAt: new Date(now.getTime() + INTERVALS_DAYS[0] * DAY_MS),
      lastSeenAt: now,
    }
  }

  // Marked difficult by the user. Treated as a reset but NOT as a wrong answer:
  // `incorrectCount` drives the "terms needing review" metric on the dashboard,
  // and self-flagging a term you find hard is not the same as getting it wrong.
  return {
    correctStreak: 0,
    incorrectCount: previous.incorrectCount,
    dueAt: new Date(now.getTime() + INTERVALS_DAYS[0] * DAY_MS),
    lastSeenAt: previous.lastSeenAt,
  }
}

/** Is this term due for review? Terms never seen are due immediately. */
export function isDue(state: ReviewState | null, now: Date = new Date()): boolean {
  if (!state || !state.dueAt) return true
  return state.dueAt.getTime() <= now.getTime()
}

/**
 * How well known is this term, for display.
 *
 * Coarse on purpose — three buckets a learner can act on, not a percentage
 * implying precision the data does not support.
 */
export function strengthOf(state: ReviewState | null): 'new' | 'learning' | 'known' {
  if (!state || state.correctStreak === 0) return state?.incorrectCount ? 'learning' : 'new'
  if (state.correctStreak >= 3) return 'known'
  return 'learning'
}

export const STRENGTH_LABELS = {
  new: { label: 'Not started', className: 'text-muted' },
  learning: { label: 'Learning', className: 'text-amber-700 dark:text-amber-300' },
  known: { label: 'Known', className: 'text-emerald-700 dark:text-emerald-300' },
} as const

/** Human phrasing for when a term comes back. */
export function dueDescription(state: ReviewState | null, now: Date = new Date()): string {
  if (!state || !state.dueAt) return 'Ready to learn'
  const days = Math.ceil((state.dueAt.getTime() - now.getTime()) / DAY_MS)
  if (days <= 0) return 'Due now'
  if (days === 1) return 'Back tomorrow'
  if (days < 7) return `Back in ${days} days`
  if (days < 30) return `Back in ${Math.round(days / 7)} weeks`
  return `Back in ${Math.round(days / 30)} months`
}
