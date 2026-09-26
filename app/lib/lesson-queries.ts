/**
 * Lesson queries
 * ==============
 *
 * Only `validated` lessons are ever returned. A lesson fails validation when
 * any correct answer neither cites a quote nor is flagged as "not enough
 * information" (see `checkQuestionValidity` in db/invariants.ts), and an
 * unvalidated lesson is withheld entirely rather than served with a warning —
 * a beginner cannot be expected to spot which question is the unsound one.
 */

import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import {
  developments,
  evidenceSpans,
  lessonOptions,
  lessonQuestions,
  lessonStages,
  lessons,
  rawDocuments,
} from '@/db/schema'
import type { DevelopmentStatus } from './labels'

export type LessonOption = {
  id: string
  label: string
  isCorrect: boolean
  isInsufficientInfo: boolean
  whyWeaker: string | null
  /** The quote that makes this option correct, when there is one. */
  evidence: { quote: string; sourceUrl: string; sourceTitle: string | null } | null
}

export type LessonQuestion = {
  id: string
  ordinal: number
  kind: string
  prompt: string
  explanation: string
  options: LessonOption[]
}

export type Lesson = {
  id: string
  developmentSlug: string
  headline: string
  status: DevelopmentStatus | null
  isSeedData: boolean
  /** Stage 1 — what happened. */
  whatHappened: string
  /** Stage 4 — the fictional client scenario. */
  applyIt: string
  /** Stage 5 — professional summary. */
  professionalSummary: string
  questions: LessonQuestion[]
}

export async function getLesson(developmentSlug: string): Promise<Lesson | null> {
  const [row] = await db
    .select({
      lessonId: lessons.id,
      developmentSlug: developments.slug,
      headline: developments.headline,
      status: developments.status,
      isSeedData: developments.isSeedData,
    })
    .from(lessons)
    .innerJoin(developments, eq(lessons.developmentId, developments.id))
    .where(eq(developments.slug, developmentSlug))

  if (!row) return null

  // Withhold anything that failed the question validator.
  const [validated] = await db
    .select({ validated: lessons.validated })
    .from(lessons)
    .where(eq(lessons.id, row.lessonId))
  if (!validated?.validated) return null

  const [stageRows, questionRows] = await Promise.all([
    db
      .select({ stage: lessonStages.stage, body: lessonStages.body })
      .from(lessonStages)
      .where(eq(lessonStages.lessonId, row.lessonId)),
    db
      .select({
        id: lessonQuestions.id,
        ordinal: lessonQuestions.ordinal,
        kind: lessonQuestions.kind,
        prompt: lessonQuestions.prompt,
        explanation: lessonQuestions.explanation,
      })
      .from(lessonQuestions)
      .where(eq(lessonQuestions.lessonId, row.lessonId))
      .orderBy(asc(lessonQuestions.ordinal)),
  ])

  const stageBody = new Map(stageRows.map((s) => [s.stage, s.body]))

  const questions: LessonQuestion[] = []
  for (const question of questionRows) {
    const optionRows = await db
      .select({
        id: lessonOptions.id,
        label: lessonOptions.label,
        isCorrect: lessonOptions.isCorrect,
        isInsufficientInfo: lessonOptions.isInsufficientInfo,
        whyWeaker: lessonOptions.whyWeaker,
        quote: evidenceSpans.quote,
        sourceUrl: rawDocuments.url,
        sourceTitle: rawDocuments.title,
      })
      .from(lessonOptions)
      .leftJoin(evidenceSpans, eq(lessonOptions.evidenceId, evidenceSpans.id))
      .leftJoin(rawDocuments, eq(evidenceSpans.rawDocumentId, rawDocuments.id))
      .where(eq(lessonOptions.questionId, question.id))
      .orderBy(asc(lessonOptions.ordinal))

    questions.push({
      ...question,
      options: optionRows.map((o) => ({
        id: o.id,
        label: o.label,
        isCorrect: o.isCorrect,
        isInsufficientInfo: o.isInsufficientInfo,
        whyWeaker: o.whyWeaker,
        evidence:
          o.quote && o.sourceUrl
            ? { quote: o.quote, sourceUrl: o.sourceUrl, sourceTitle: o.sourceTitle }
            : null,
      })),
    })
  }

  return {
    id: row.lessonId,
    developmentSlug: row.developmentSlug,
    headline: row.headline,
    status: row.status as DevelopmentStatus | null,
    isSeedData: row.isSeedData,
    whatHappened: stageBody.get(1) ?? '',
    applyIt: stageBody.get(4) ?? '',
    professionalSummary: stageBody.get(5) ?? '',
    questions,
  }
}

export type LessonListItem = {
  developmentSlug: string
  headline: string
  status: DevelopmentStatus | null
  questionCount: number
  isSeedData: boolean
}

/** Every lesson available to take. */
export async function listLessons(): Promise<LessonListItem[]> {
  const rows = await db
    .select({
      developmentSlug: developments.slug,
      headline: developments.headline,
      status: developments.status,
      isSeedData: developments.isSeedData,
      lessonId: lessons.id,
    })
    .from(lessons)
    .innerJoin(developments, eq(lessons.developmentId, developments.id))
    .where(eq(lessons.validated, true))

  const counts = await db
    .select({ lessonId: lessonQuestions.lessonId, id: lessonQuestions.id })
    .from(lessonQuestions)

  const countByLesson = counts.reduce<Map<string, number>>((map, r) => {
    map.set(r.lessonId, (map.get(r.lessonId) ?? 0) + 1)
    return map
  }, new Map())

  return rows.map((r) => ({
    developmentSlug: r.developmentSlug,
    headline: r.headline,
    status: r.status as DevelopmentStatus | null,
    isSeedData: r.isSeedData,
    questionCount: countByLesson.get(r.lessonId) ?? 0,
  }))
}
