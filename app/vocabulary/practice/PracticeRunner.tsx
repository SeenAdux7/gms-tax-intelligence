'use client'

/**
 * Vocabulary Practice and Review
 * ==============================
 *
 * One component serves both modes, because Review IS Practice restricted to
 * terms that are due, flagged difficult, or previously answered wrong. Building
 * them separately would have meant two implementations of the same interaction
 * drifting apart.
 *
 * Feedback is immediate here, unlike the lesson flow. The difference is
 * deliberate: a lesson asks you to reason about a development and separates
 * thinking from revealing, whereas practice is recall drilling, where a delayed
 * answer just means you have forgotten what you guessed.
 *
 * Every answer advances the term's spaced-repetition schedule server-side, and
 * the server decides correctness — the client only reports which option was
 * chosen.
 */

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { recordPracticeAnswer } from '../../actions'
import type { PracticeQuestion } from '../../lib/vocab-queries'

type Answered = { chosenTermId: string; correct: boolean }

export function PracticeRunner({
  questions,
  mode,
}: {
  questions: PracticeQuestion[]
  mode: 'practice' | 'review'
}) {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<number, Answered>>({})
  const [, startTransition] = useTransition()

  const question = questions[index]
  const answered = answers[index]
  const atEnd = index >= questions.length
  const correctCount = Object.values(answers).filter((a) => a.correct).length

  function choose(chosenTermId: string) {
    if (answered) return // one attempt per question per session

    // Optimistic: the comparison is a plain id match, so the client can show
    // the result immediately. The server still recomputes it authoritatively
    // before writing — this is display, not the record.
    const correct = chosenTermId === question.termId
    setAnswers((prev) => ({ ...prev, [index]: { chosenTermId, correct } }))

    startTransition(async () => {
      await recordPracticeAnswer({ termId: question.termId, chosenTermId })
    })
  }

  if (atEnd) {
    return (
      <main className="flex-1 px-4 py-6">
        <div className="rounded-xl border border-line bg-surface-raised p-5 text-center">
          <h1 className="text-[16px] font-semibold">
            {correctCount} of {questions.length} right
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-muted">
            {correctCount === questions.length
              ? 'All correct. These terms will come back less often now.'
              : 'The ones you missed will come back tomorrow, and more often than the rest until they stick.'}
          </p>
          <div className="mt-5 space-y-2">
            <Link
              href="/vocabulary/review"
              className="block rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-white"
            >
              Review what needs work
            </Link>
            <Link
              href="/vocabulary"
              className="block rounded-lg bg-surface px-4 py-2.5 text-[13px] font-medium text-accent ring-1 ring-line"
            >
              Back to vocabulary
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="flex flex-1 flex-col">
      <header className="px-4 pt-4 pb-3">
        <Link href="/vocabulary" className="text-[13px] font-medium text-accent hover:underline">
          ← Vocabulary
        </Link>
        <h1 className="mt-2 text-[15px] font-semibold">
          {mode === 'review' ? 'Review' : 'Practice'}
        </h1>
      </header>

      <div className="px-4 pb-4">
        <div className="flex items-center gap-1.5">
          {questions.map((q, i) => (
            <div
              key={`${q.termId}-${i}`}
              className={`h-1 flex-1 rounded-full ${
                answers[i]
                  ? answers[i].correct
                    ? 'bg-emerald-500'
                    : 'bg-amber-500'
                  : i === index
                    ? 'bg-accent/50'
                    : 'bg-line'
              }`}
            />
          ))}
        </div>
        <p className="mt-2 text-[11px] font-medium text-muted">
          Question {index + 1} of {questions.length}
        </p>
      </div>

      <div className="flex-1 px-4">
        <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">
          {question.instruction}
        </p>

        <div className="mt-2 rounded-xl border border-line bg-surface-raised px-4 py-3.5">
          <p className="text-[15px] leading-relaxed font-medium text-foreground">
            {question.prompt}
          </p>
        </div>

        <div className="mt-3 space-y-2">
          {question.options.map((option) => {
            const isChosen = answered?.chosenTermId === option.termId
            const reveal = Boolean(answered)

            let tone = 'bg-surface ring-line hover:ring-accent/40'
            if (reveal && option.isCorrect) {
              tone = 'bg-emerald-500/10 ring-emerald-500/40'
            } else if (reveal && isChosen) {
              tone = 'bg-amber-500/10 ring-amber-500/40'
            } else if (reveal) {
              tone = 'bg-surface ring-line opacity-55'
            }

            return (
              <button
                key={option.termId}
                type="button"
                onClick={() => choose(option.termId)}
                disabled={reveal}
                className={`block w-full rounded-lg px-3.5 py-3 text-left text-[13px] leading-snug ring-1 transition-colors ${tone}`}
              >
                <span className="text-foreground/90">{option.label}</span>
                {reveal && option.isCorrect && (
                  <span className="mt-1 block text-[10px] font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-300">
                    Correct
                  </span>
                )}
                {reveal && isChosen && !option.isCorrect && (
                  <span className="mt-1 block text-[10px] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-300">
                    You chose this
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {answered && (
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            {answered.correct
              ? 'Right — this term will come back less often now.'
              : 'Not quite. This term will come back tomorrow.'}
          </p>
        )}
      </div>

      <div className="sticky bottom-0 mt-6 border-t border-line bg-background/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => setIndex((i) => i + 1)}
          disabled={!answered}
          className="w-full rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-white disabled:opacity-35"
        >
          {!answered
            ? 'Pick an answer'
            : index === questions.length - 1
              ? 'See results'
              : 'Next question'}
        </button>
      </div>
    </main>
  )
}
