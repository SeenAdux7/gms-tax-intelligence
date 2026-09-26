'use client'

/**
 * The five-stage swipe-through lesson
 * ===================================
 *
 * "Swiping right or using clear next and back controls should move between the
 * following stages." Both, then — swipe for phones, buttons for everyone,
 * arrow keys for keyboards. A gesture-only interface would be unusable with a
 * screen reader and awkward on a laptop.
 *
 * Deliberate behaviours worth knowing about:
 *
 *   - Stage 2 will not let you advance until every question is answered.
 *     Skipping the thinking and reading the answer is the one way to get
 *     nothing out of this, so the flow declines to allow it.
 *
 *   - Answers cannot be changed once you reach stage 3. The score is a signal
 *     to the learner about what they actually knew, and quietly correcting a
 *     wrong answer after seeing the explanation destroys that.
 *
 *   - Getting a question wrong is not styled as a failure. The brief's whole
 *     premise is a beginner learning by reasoning about real developments, and
 *     stage 3 exists to explain, not to score.
 */

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Lesson } from '../../lib/lesson-queries'
import { STATUS_LABELS, STATUS_UNKNOWN } from '../../lib/labels'
import { recordAttempts } from '../actions'

const STAGE_TITLES = [
  'What happened',
  'Think about the impact',
  'Understand the answer',
  'Apply it',
  'Professional summary',
] as const

const TOTAL_STAGES = 5

export function LessonFlow({ lesson }: { lesson: Lesson }) {
  const [stage, setStage] = useState(1)
  /** questionId -> chosen optionId. */
  const [answers, setAnswers] = useState<Record<string, string>>({})
  /** Locked once stage 3 is reached, so the score reflects real first attempts. */
  const [locked, setLocked] = useState(false)

  const allAnswered = lesson.questions.every((q) => answers[q.id])
  const canGoNext = stage < TOTAL_STAGES && !(stage === 2 && !allAnswered)
  const canGoBack = stage > 1

  const goNext = useCallback(() => {
    if (stage === 2 && !allAnswered) return
    setStage((s) => {
      const next = Math.min(s + 1, TOTAL_STAGES)
      // Crossing from 2 to 3 is the commitment point.
      if (s === 2 && next === 3) setLocked(true)
      return next
    })
  }, [stage, allAnswered])

  const goBack = useCallback(() => setStage((s) => Math.max(s - 1, 1)), [])

  /* --- record attempts once, when answers are committed ----------------
   * Fire-and-forget: this feeds the dashboard's accuracy metric and the
   * spaced-repetition schedule. A failed write should not interrupt a lesson,
   * so it is deliberately not awaited or surfaced. */
  const recorded = useRef(false)
  useEffect(() => {
    if (!locked || recorded.current) return
    recorded.current = true

    const payload = lesson.questions.map((question) => {
      const chosenId = answers[question.id]
      const chosen = question.options.find((o) => o.id === chosenId)
      return {
        questionId: question.id,
        selectedOptionIds: chosenId ? [chosenId] : [],
        wasCorrect: Boolean(chosen?.isCorrect),
      }
    })

    void recordAttempts(payload)
  }, [locked, answers, lesson.questions])

  /* --- keyboard ------------------------------------------------------- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Don't hijack arrows while the user is inside a control.
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return
      if (event.key === 'ArrowRight') goNext()
      if (event.key === 'ArrowLeft') goBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goBack])

  /* --- swipe -----------------------------------------------------------
   * Tracks the dominant axis so a vertical scroll through a long stage is
   * never mistaken for a horizontal swipe — the single most common way a
   * swipe implementation becomes infuriating on a phone. */
  const touch = useRef<{ x: number; y: number } | null>(null)

  const onTouchStart = (event: React.TouchEvent) => {
    const point = event.touches[0]
    touch.current = { x: point.clientX, y: point.clientY }
  }

  const onTouchEnd = (event: React.TouchEvent) => {
    if (!touch.current) return
    const point = event.changedTouches[0]
    const dx = point.clientX - touch.current.x
    const dy = point.clientY - touch.current.y
    touch.current = null

    const MIN_DISTANCE = 55
    if (Math.abs(dx) < MIN_DISTANCE) return
    if (Math.abs(dy) > Math.abs(dx)) return // vertical scroll, not a swipe

    if (dx < 0) goNext()
    else goBack()
  }

  const statusMeta = lesson.status ? STATUS_LABELS[lesson.status] : STATUS_UNKNOWN
  const correctCount = lesson.questions.filter((q) =>
    q.options.find((o) => o.id === answers[q.id])?.isCorrect,
  ).length

  return (
    <div className="flex flex-1 flex-col" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* --- header ---------------------------------------------------- */}
      <header className="px-4 pt-4 pb-3">
        <Link
          href="/learn"
          className="text-[13px] font-medium text-accent hover:underline"
        >
          ← Lessons
        </Link>
        <h1 className="mt-2 text-[15px] leading-snug font-semibold">{lesson.headline}</h1>
        <p className="mt-1 text-[11px] text-muted">{statusMeta.label}</p>
      </header>

      {/* --- progress -------------------------------------------------- */}
      <div className="px-4 pb-4">
        <div className="flex items-center gap-1.5" role="group" aria-label="Lesson progress">
          {Array.from({ length: TOTAL_STAGES }, (_, i) => i + 1).map((n) => (
            <div
              key={n}
              className={`h-1 flex-1 rounded-full transition-colors ${
                n <= stage ? 'bg-accent' : 'bg-line'
              }`}
            />
          ))}
        </div>
        <p className="mt-2 text-[11px] font-medium text-muted">
          Step {stage} of {TOTAL_STAGES} · {STAGE_TITLES[stage - 1]}
        </p>
      </div>

      {/* --- stage content --------------------------------------------- */}
      <div className="flex-1 px-4">
        {stage === 1 && <Prose body={lesson.whatHappened} />}

        {stage === 2 && (
          <div className="space-y-6">
            <Hint>
              Have a go before moving on. Getting it wrong is genuinely fine — the next step
              explains every option.
            </Hint>
            {lesson.questions.map((question, index) => (
              <QuestionCard
                key={question.id}
                index={index + 1}
                total={lesson.questions.length}
                question={question}
                chosenId={answers[question.id]}
                disabled={locked}
                onChoose={(optionId) =>
                  setAnswers((prev) => ({ ...prev, [question.id]: optionId }))
                }
              />
            ))}
            {!allAnswered && (
              <p className="text-[12px] text-muted">
                Answer every question to continue.
              </p>
            )}
          </div>
        )}

        {stage === 3 && (
          <div className="space-y-6">
            <div className="rounded-lg bg-surface px-3 py-2.5 text-[13px] text-foreground/85 ring-1 ring-line">
              You got <strong>{correctCount}</strong> of {lesson.questions.length}.{' '}
              {correctCount === lesson.questions.length
                ? 'Read the explanations anyway — they cover why the other options fail.'
                : 'The explanations below cover why each option works or does not.'}
            </div>
            {lesson.questions.map((question, index) => (
              <AnswerCard
                key={question.id}
                index={index + 1}
                question={question}
                chosenId={answers[question.id]}
              />
            ))}
          </div>
        )}

        {stage === 4 && (
          <div className="space-y-4">
            <div className="rounded-lg bg-fuchsia-500/10 px-3 py-2 text-[12px] leading-relaxed text-fuchsia-900 ring-1 ring-fuchsia-500/25 dark:text-fuchsia-200">
              <strong className="font-semibold">Fictional client.</strong> This company and its
              employees are invented for practice. No real client data is used anywhere in this app.
            </div>
            <Prose body={lesson.applyIt} />
            <div className="rounded-xl border border-line bg-surface-raised p-4">
              <h3 className="text-[13px] font-semibold">Think it through</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                There is no answer to submit here. The habit worth building is asking{' '}
                <em>what facts would I need</em> before giving an answer — which is usually a
                better response to a client than a confident guess.
              </p>
            </div>
          </div>
        )}

        {stage === 5 && (
          <div className="space-y-4">
            <Hint>
              This is the register you would write in for a colleague or a client — compressed,
              dated, and explicit about what is unresolved.
            </Hint>
            <div className="rounded-xl border border-line bg-surface-raised p-4">
              <Prose body={lesson.professionalSummary} small />
            </div>
            <Link
              href={`/updates/${lesson.developmentSlug}`}
              className="block rounded-lg bg-surface px-4 py-3 text-center text-[13px] font-medium text-accent ring-1 ring-line"
            >
              See the full update and its sources
            </Link>
            <Link
              href="/learn"
              className="block rounded-lg bg-accent px-4 py-3 text-center text-[13px] font-medium text-white"
            >
              Back to lessons
            </Link>
          </div>
        )}
      </div>

      {/* --- controls --------------------------------------------------- */}
      <div className="sticky bottom-0 mt-6 border-t border-line bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={goBack}
            disabled={!canGoBack}
            className="rounded-lg px-4 py-2.5 text-[13px] font-medium text-foreground/80 ring-1 ring-line disabled:opacity-35"
          >
            Back
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!canGoNext}
            className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-white disabled:opacity-35"
          >
            {stage === TOTAL_STAGES
              ? 'Finished'
              : stage === 2 && !allAnswered
                ? 'Answer the questions to continue'
                : `Next · ${STAGE_TITLES[stage]}`}
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted">
          Swipe, or use the arrow keys
        </p>
      </div>
    </div>
  )
}

/* ==========================================================================
 * Pieces
 * ========================================================================== */

function Prose({ body, small = false }: { body: string; small?: boolean }) {
  return (
    <div className={`space-y-3 ${small ? 'text-[13px]' : 'text-[14px]'} leading-relaxed`}>
      {body
        .split('\n\n')
        .filter(Boolean)
        .map((paragraph, i) => (
          <p key={i} className="whitespace-pre-line text-foreground/90">
            {paragraph}
          </p>
        ))}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-relaxed text-muted">{children}</p>
}

function QuestionCard({
  index,
  total,
  question,
  chosenId,
  disabled,
  onChoose,
}: {
  index: number
  total: number
  question: Lesson['questions'][number]
  chosenId?: string
  disabled: boolean
  onChoose: (optionId: string) => void
}) {
  return (
    <fieldset disabled={disabled} className="rounded-xl border border-line bg-surface-raised p-4">
      <legend className="sr-only">{question.prompt}</legend>
      <p className="text-[10px] font-semibold tracking-wide text-muted uppercase">
        Question {index} of {total}
      </p>
      <p className="mt-1.5 text-[14px] leading-snug font-medium">{question.prompt}</p>

      <div className="mt-3 space-y-2">
        {question.options.map((option) => {
          const chosen = chosenId === option.id
          return (
            <label
              key={option.id}
              className={`flex cursor-pointer gap-2.5 rounded-lg px-3 py-2.5 text-[13px] leading-snug ring-1 transition-colors ${
                chosen
                  ? 'bg-accent/10 ring-accent'
                  : 'bg-surface ring-line hover:ring-accent/40'
              }`}
            >
              <input
                type="radio"
                name={question.id}
                value={option.id}
                checked={chosen}
                onChange={() => onChoose(option.id)}
                className="mt-0.5 shrink-0 accent-[var(--accent)]"
              />
              <span className="text-foreground/90">{option.label}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/**
 * Stage 3 — reveal.
 *
 * Shows the correct answer, why it is stronger, and for a wrong choice, why
 * that specific option is weaker. Where the correct answer cites a quote, the
 * quote is shown inline: connecting the answer back to the source is the point
 * of the exercise, not a footnote to it.
 */
function AnswerCard({
  index,
  question,
  chosenId,
}: {
  index: number
  question: Lesson['questions'][number]
  chosenId?: string
}) {
  const chosen = question.options.find((o) => o.id === chosenId)
  const correct = question.options.find((o) => o.isCorrect)
  const gotItRight = Boolean(chosen?.isCorrect)

  return (
    <div className="rounded-xl border border-line bg-surface-raised p-4">
      <p className="text-[10px] font-semibold tracking-wide text-muted uppercase">
        Question {index}
      </p>
      <p className="mt-1.5 text-[14px] leading-snug font-medium">{question.prompt}</p>

      <p
        className={`mt-3 text-[12px] font-semibold ${
          gotItRight ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'
        }`}
      >
        {gotItRight ? 'You had it right' : 'Not the strongest answer'}
      </p>

      {/* The correct answer. */}
      {correct && (
        <div className="mt-2 rounded-lg bg-emerald-500/10 px-3 py-2.5 ring-1 ring-emerald-500/30">
          <p className="text-[11px] font-semibold tracking-wide text-emerald-800 uppercase dark:text-emerald-300">
            Strongest answer
          </p>
          <p className="mt-1 text-[13px] leading-snug text-foreground/90">{correct.label}</p>

          {correct.evidence ? (
            <blockquote className="mt-2.5 border-l-2 border-emerald-500/50 pl-2.5 text-[12px] leading-relaxed text-foreground/80">
              &ldquo;{correct.evidence.quote}&rdquo;
              <footer className="mt-1.5 text-[10px] not-italic">
                <a
                  href={correct.evidence.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  {correct.evidence.sourceTitle ?? 'Source'} ↗
                </a>
              </footer>
            </blockquote>
          ) : correct.isInsufficientInfo ? (
            // No quote, and that is the finding — not a gap in the lesson.
            <p className="mt-2.5 border-l-2 border-emerald-500/50 pl-2.5 text-[12px] leading-relaxed text-muted italic">
              There is no quote to show, because the source does not address this. That absence is
              the answer.
            </p>
          ) : null}
        </div>
      )}

      {/* Why the chosen distractor was weaker. */}
      {!gotItRight && chosen?.whyWeaker && (
        <div className="mt-2 rounded-lg bg-surface px-3 py-2.5 ring-1 ring-line">
          <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">
            You chose
          </p>
          <p className="mt-1 text-[13px] leading-snug text-foreground/90">{chosen.label}</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{chosen.whyWeaker}</p>
        </div>
      )}

      <div className="mt-3">
        <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Why</p>
        <p className="mt-1 text-[13px] leading-relaxed text-foreground/85">{question.explanation}</p>
      </div>

      {/* The remaining options, collapsed. */}
      <details className="group mt-3">
        <summary className="cursor-pointer list-none text-[11px] font-medium text-accent">
          <span className="group-open:hidden">Why the other options fail</span>
          <span className="hidden group-open:inline">Hide</span>
        </summary>
        <ul className="mt-2 space-y-2">
          {question.options
            .filter((o) => !o.isCorrect && o.id !== chosenId && o.whyWeaker)
            .map((o) => (
              <li key={o.id} className="border-l-2 border-line pl-2.5">
                <p className="text-[12px] text-foreground/80">{o.label}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{o.whyWeaker}</p>
              </li>
            ))}
        </ul>
      </details>
    </div>
  )
}
