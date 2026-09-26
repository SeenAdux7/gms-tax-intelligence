/**
 * Vocabulary queries
 * ==================
 *
 * Browse, single term, and the term sets that drive Learn, Practice, and
 * Review. All deterministic SQL; the practice distractors are chosen by rule,
 * not generated.
 */

import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  developmentTerms,
  developments,
  savedItems,
  termReviewState,
  vocabRelations,
  vocabTerms,
} from '@/db/schema'
import { isDue, strengthOf, type ReviewState } from './spaced-repetition'

export type VocabCategory =
  | 'tax'
  | 'payroll'
  | 'assignments'
  | 'treaties'
  | 'residency'
  | 'social_security'
  | 'benefits'
  | 'policy'
  | 'compliance'
  | 'other'

export const CATEGORY_LABELS: Record<VocabCategory, string> = {
  tax: 'Tax',
  payroll: 'Payroll',
  assignments: 'Assignments',
  treaties: 'Treaties',
  residency: 'Residency',
  social_security: 'Social security',
  benefits: 'Benefits',
  policy: 'Policy',
  compliance: 'Compliance',
  other: 'Other',
}

const LOCAL_USER = 'local'

export type TermSummary = {
  id: string
  slug: string
  term: string
  definition: string
  category: VocabCategory
  strength: 'new' | 'learning' | 'known'
  saved: boolean
  markedDifficult: boolean
}

/* ==========================================================================
 * Browse
 * ========================================================================== */

export async function browseTerms(options: {
  search?: string
  category?: VocabCategory
}): Promise<TermSummary[]> {
  const conditions = []

  if (options.search?.trim()) {
    const like = `%${options.search.trim()}%`
    conditions.push(
      or(
        sql`${vocabTerms.term} ILIKE ${like}`,
        sql`${vocabTerms.definition} ILIKE ${like}`,
        sql`${vocabTerms.whyItMatters} ILIKE ${like}`,
      )!,
    )
  }
  if (options.category) {
    conditions.push(eq(vocabTerms.category, options.category))
  }

  const rows = await db
    .select({
      id: vocabTerms.id,
      slug: vocabTerms.slug,
      term: vocabTerms.term,
      definition: vocabTerms.definition,
      category: vocabTerms.category,
      correctStreak: termReviewState.correctStreak,
      incorrectCount: termReviewState.incorrectCount,
      dueAt: termReviewState.dueAt,
      lastSeenAt: termReviewState.lastSeenAt,
      bookmarked: savedItems.bookmarked,
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
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(vocabTerms.term))

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    term: r.term,
    definition: r.definition,
    category: r.category as VocabCategory,
    strength: strengthOf(toReviewState(r)),
    saved: Boolean(r.bookmarked),
    markedDifficult: Boolean(r.markedDifficult),
  }))
}

function toReviewState(row: {
  correctStreak: number | null
  incorrectCount: number | null
  dueAt: Date | null
  lastSeenAt: Date | null
}): ReviewState | null {
  if (row.correctStreak === null && row.incorrectCount === null && !row.dueAt) return null
  return {
    correctStreak: row.correctStreak ?? 0,
    incorrectCount: row.incorrectCount ?? 0,
    dueAt: row.dueAt,
    lastSeenAt: row.lastSeenAt,
  }
}

/** Categories that actually have terms, with counts. */
export async function getVocabCategories() {
  const rows = await db
    .select({ category: vocabTerms.category, count: sql<number>`count(*)::int` })
    .from(vocabTerms)
    .groupBy(vocabTerms.category)

  return rows
    .map((r) => ({ category: r.category as VocabCategory, count: r.count }))
    .sort((a, b) => CATEGORY_LABELS[a.category].localeCompare(CATEGORY_LABELS[b.category]))
}

/* ==========================================================================
 * Single term
 * ========================================================================== */

export type TermDetail = {
  id: string
  slug: string
  term: string
  definition: string
  whyItMatters: string
  example: string
  commonMisunderstanding: string | null
  formalDefinition: string | null
  formalDefinitionSourceUrl: string | null
  category: VocabCategory
  related: { slug: string; term: string; definition: string }[]
  /** Updates in the feed that mention this term. */
  appearsIn: { slug: string; headline: string }[]
  strength: 'new' | 'learning' | 'known'
  saved: boolean
  markedDifficult: boolean
}

export async function getTerm(slug: string): Promise<TermDetail | null> {
  const [row] = await db
    .select({
      id: vocabTerms.id,
      slug: vocabTerms.slug,
      term: vocabTerms.term,
      definition: vocabTerms.definition,
      whyItMatters: vocabTerms.whyItMatters,
      example: vocabTerms.example,
      commonMisunderstanding: vocabTerms.commonMisunderstanding,
      formalDefinition: vocabTerms.formalDefinition,
      formalDefinitionSourceUrl: vocabTerms.formalDefinitionSourceUrl,
      category: vocabTerms.category,
      correctStreak: termReviewState.correctStreak,
      incorrectCount: termReviewState.incorrectCount,
      dueAt: termReviewState.dueAt,
      lastSeenAt: termReviewState.lastSeenAt,
      bookmarked: savedItems.bookmarked,
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
    .where(eq(vocabTerms.slug, slug))

  if (!row) return null

  const [relatedRows, appearsInRows] = await Promise.all([
    db
      .select({
        slug: vocabTerms.slug,
        term: vocabTerms.term,
        definition: vocabTerms.definition,
      })
      .from(vocabRelations)
      .innerJoin(vocabTerms, eq(vocabRelations.relatedTermId, vocabTerms.id))
      .where(eq(vocabRelations.termId, row.id))
      .orderBy(asc(vocabTerms.term)),
    db
      .select({ slug: developments.slug, headline: developments.headline })
      .from(developmentTerms)
      .innerJoin(developments, eq(developmentTerms.developmentId, developments.id))
      .where(
        and(eq(developmentTerms.termId, row.id), eq(developments.reviewState, 'approved')),
      ),
  ])

  return {
    id: row.id,
    slug: row.slug,
    term: row.term,
    definition: row.definition,
    whyItMatters: row.whyItMatters,
    example: row.example,
    commonMisunderstanding: row.commonMisunderstanding,
    formalDefinition: row.formalDefinition,
    formalDefinitionSourceUrl: row.formalDefinitionSourceUrl,
    category: row.category as VocabCategory,
    related: relatedRows,
    appearsIn: appearsInRows,
    strength: strengthOf(toReviewState(row)),
    saved: Boolean(row.bookmarked),
    markedDifficult: Boolean(row.markedDifficult),
  }
}

/** Terms linked to a development, for the tappable terms on an update. */
export async function getTermsForDevelopment(developmentSlug: string) {
  return db
    .select({ slug: vocabTerms.slug, term: vocabTerms.term, definition: vocabTerms.definition })
    .from(developmentTerms)
    .innerJoin(developments, eq(developmentTerms.developmentId, developments.id))
    .innerJoin(vocabTerms, eq(developmentTerms.termId, vocabTerms.id))
    .where(eq(developments.slug, developmentSlug))
    .orderBy(asc(vocabTerms.term))
}

/* ==========================================================================
 * Learn — a small set of cards to swipe through
 * ========================================================================== */

export type LearnCard = {
  id: string
  slug: string
  term: string
  definition: string
  whyItMatters: string
  example: string
  commonMisunderstanding: string | null
  related: string[]
}

/**
 * Picks the next few terms to learn.
 *
 * Weakest first: never-seen terms, then terms with wrong answers against them.
 * "A small set" per the brief — a fixed 5, because a swipe deck with no end is
 * a chore rather than a session.
 */
export async function getLearnSet(limit = 5): Promise<LearnCard[]> {
  const rows = await db
    .select({
      id: vocabTerms.id,
      slug: vocabTerms.slug,
      term: vocabTerms.term,
      definition: vocabTerms.definition,
      whyItMatters: vocabTerms.whyItMatters,
      example: vocabTerms.example,
      commonMisunderstanding: vocabTerms.commonMisunderstanding,
      correctStreak: termReviewState.correctStreak,
      incorrectCount: termReviewState.incorrectCount,
      lastSeenAt: termReviewState.lastSeenAt,
    })
    .from(vocabTerms)
    .leftJoin(
      termReviewState,
      and(eq(termReviewState.termId, vocabTerms.id), eq(termReviewState.userId, LOCAL_USER)),
    )
    .orderBy(
      // Never-seen first, then weakest.
      sql`${termReviewState.lastSeenAt} NULLS FIRST`,
      asc(sql`COALESCE(${termReviewState.correctStreak}, 0)`),
    )
    .limit(limit)

  const ids = rows.map((r) => r.id)
  const relatedRows = ids.length
    ? await db
        .select({ termId: vocabRelations.termId, term: vocabTerms.term })
        .from(vocabRelations)
        .innerJoin(vocabTerms, eq(vocabRelations.relatedTermId, vocabTerms.id))
        .where(inArray(vocabRelations.termId, ids))
    : []

  const relatedByTerm = relatedRows.reduce<Map<string, string[]>>((map, r) => {
    map.set(r.termId, [...(map.get(r.termId) ?? []), r.term])
    return map
  }, new Map())

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    term: r.term,
    definition: r.definition,
    whyItMatters: r.whyItMatters,
    example: r.example,
    commonMisunderstanding: r.commonMisunderstanding,
    related: relatedByTerm.get(r.id) ?? [],
  }))
}

/* ==========================================================================
 * Practice and Review
 * ========================================================================== */

export type PracticeQuestion = {
  termId: string
  kind: 'definition_to_term' | 'scenario_to_term' | 'term_to_definition'
  prompt: string
  /** The question's own framing line, e.g. "Which term fits this example?" */
  instruction: string
  options: { termId: string; label: string; isCorrect: boolean }[]
}

/**
 * Builds a practice set.
 *
 * Distractors are chosen from the SAME CATEGORY as the answer wherever
 * possible. This matters: a question that offers "tax equalization" against
 * three obviously unrelated payroll terms can be answered by elimination
 * without knowing anything. Same-category distractors force the distinction
 * the brief actually asks for — "distinguish related concepts".
 *
 * `onlyWeak` restricts the set to terms that are due or have been answered
 * wrong, which is what Review mode is.
 */
export async function getPracticeSet(options: {
  limit?: number
  onlyWeak?: boolean
}): Promise<PracticeQuestion[]> {
  const limit = options.limit ?? 8

  const allTerms = await db
    .select({
      id: vocabTerms.id,
      term: vocabTerms.term,
      definition: vocabTerms.definition,
      example: vocabTerms.example,
      category: vocabTerms.category,
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

  if (allTerms.length < 2) return []

  let candidates = allTerms
  if (options.onlyWeak) {
    candidates = allTerms.filter((t) => {
      const state = toReviewState(t)
      return Boolean(t.markedDifficult) || (t.incorrectCount ?? 0) > 0 || isDue(state)
    })
  }

  // Weakest first, so a short session covers what is least known.
  candidates = candidates
    .slice()
    .sort((a, b) => {
      const weakness = (t: typeof a) =>
        (t.markedDifficult ? -100 : 0) + (t.correctStreak ?? 0) - (t.incorrectCount ?? 0) * 2
      return weakness(a) - weakness(b)
    })
    .slice(0, limit)

  const questions: PracticeQuestion[] = []

  for (const [index, target] of candidates.entries()) {
    // Rotate question shape so a session is not eight identical prompts.
    const kinds: PracticeQuestion['kind'][] = [
      'definition_to_term',
      'scenario_to_term',
      'term_to_definition',
    ]
    const kind = kinds[index % kinds.length]

    const sameCategory = allTerms.filter(
      (t) => t.id !== target.id && t.category === target.category,
    )
    const otherCategory = allTerms.filter(
      (t) => t.id !== target.id && t.category !== target.category,
    )
    // Prefer same-category distractors; top up from elsewhere only if the
    // category is too small to fill the options.
    const distractors = [...shuffle(sameCategory), ...shuffle(otherCategory)].slice(0, 3)

    if (kind === 'term_to_definition') {
      questions.push({
        termId: target.id,
        kind,
        instruction: 'Which definition fits this term?',
        prompt: target.term,
        options: shuffle([
          { termId: target.id, label: target.definition, isCorrect: true },
          ...distractors.map((d) => ({ termId: d.id, label: d.definition, isCorrect: false })),
        ]),
      })
    } else {
      questions.push({
        termId: target.id,
        kind,
        instruction:
          kind === 'scenario_to_term'
            ? 'Which term does this describe?'
            : 'Which term matches this definition?',
        prompt: kind === 'scenario_to_term' ? target.example : target.definition,
        options: shuffle([
          { termId: target.id, label: target.term, isCorrect: true },
          ...distractors.map((d) => ({ termId: d.id, label: d.term, isCorrect: false })),
        ]),
      })
    }
  }

  return questions
}

/**
 * Fisher-Yates. Not seeded: option order should differ between attempts so the
 * position of the right answer is never learnable.
 */
function shuffle<T>(items: T[]): T[] {
  const copy = items.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** Counts for the vocabulary landing page. */
export async function getVocabProgress() {
  const rows = await db
    .select({
      id: vocabTerms.id,
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

  for (const row of rows) {
    const state = toReviewState(row)
    const strength = strengthOf(state)
    if (strength === 'known') known += 1
    else if (strength === 'learning') learning += 1
    else notStarted += 1

    if (row.markedDifficult || (row.incorrectCount ?? 0) > 0 || isDue(state, now)) {
      needsReview += 1
    }
  }

  return { total: rows.length, known, learning, notStarted, needsReview }
}
