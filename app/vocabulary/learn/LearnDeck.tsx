'use client'

/**
 * Vocabulary Learn mode — a small swipe-through deck
 * ==================================================
 *
 * "Swipe through a small set of terms, examples, and related concepts."
 *
 * No questions here, and that is the distinction from Practice. This mode is
 * for meeting a term for the first time; being tested on something you have
 * just been shown measures short-term memory, not learning. Nothing here writes
 * to the review schedule either — a term becomes "learning" once you have
 * actually answered something about it.
 */

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LearnCard } from '../../lib/vocab-queries'

export function LearnDeck({ cards }: { cards: LearnCard[] }) {
  const [index, setIndex] = useState(0)
  const atEnd = index >= cards.length

  const next = useCallback(() => setIndex((i) => Math.min(i + 1, cards.length)), [cards.length])
  const back = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'BUTTON', 'A'].includes(target.tagName)) return
      if (event.key === 'ArrowRight') next()
      if (event.key === 'ArrowLeft') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, back])

  const touch = useRef<{ x: number; y: number } | null>(null)

  return (
    <div
      className="flex flex-1 flex-col"
      onTouchStart={(e) => {
        const p = e.touches[0]
        touch.current = { x: p.clientX, y: p.clientY }
      }}
      onTouchEnd={(e) => {
        if (!touch.current) return
        const p = e.changedTouches[0]
        const dx = p.clientX - touch.current.x
        const dy = p.clientY - touch.current.y
        touch.current = null
        if (Math.abs(dx) < 55 || Math.abs(dy) > Math.abs(dx)) return
        if (dx < 0) next()
        else back()
      }}
    >
      <header className="px-4 pt-4 pb-3">
        <Link href="/vocabulary" className="text-[13px] font-medium text-accent hover:underline">
          ← Vocabulary
        </Link>
      </header>

      <div className="px-4 pb-4">
        <div className="flex items-center gap-1.5">
          {cards.map((card, i) => (
            <div
              key={card.id}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i < index ? 'bg-accent' : i === index ? 'bg-accent/50' : 'bg-line'
              }`}
            />
          ))}
        </div>
        <p className="mt-2 text-[11px] font-medium text-muted">
          {atEnd ? 'Finished' : `Card ${index + 1} of ${cards.length}`}
        </p>
      </div>

      <div className="flex-1 px-4">
        {atEnd ? (
          <div className="rounded-xl border border-line bg-surface-raised p-5 text-center">
            <h2 className="text-[16px] font-semibold">That is the set</h2>
            <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-muted">
              You have seen {cards.length} terms. Practice is where they actually stick — it asks you
              to tell them apart, which is the hard part.
            </p>
            <div className="mt-5 space-y-2">
              <Link
                href="/vocabulary/practice"
                className="block rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-white"
              >
                Practice these
              </Link>
              <Link
                href="/vocabulary"
                className="block rounded-lg bg-surface px-4 py-2.5 text-[13px] font-medium text-accent ring-1 ring-line"
              >
                Back to vocabulary
              </Link>
            </div>
          </div>
        ) : (
          <Card card={cards[index]} />
        )}
      </div>

      <div className="sticky bottom-0 mt-6 border-t border-line bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={back}
            disabled={index === 0}
            className="rounded-lg px-4 py-2.5 text-[13px] font-medium text-foreground/80 ring-1 ring-line disabled:opacity-35"
          >
            Back
          </button>
          <button
            type="button"
            onClick={next}
            disabled={atEnd}
            className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-white disabled:opacity-35"
          >
            {index === cards.length - 1 ? 'Finish' : 'Next'}
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted">Swipe, or use the arrow keys</p>
      </div>
    </div>
  )
}

function Card({ card }: { card: LearnCard }) {
  return (
    <article className="space-y-3">
      <div className="rounded-xl border border-line bg-surface-raised px-4 py-4">
        <h2 className="text-xl font-semibold tracking-tight">{card.term}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-foreground/90">{card.definition}</p>
      </div>

      <Block title="Why it matters">{card.whyItMatters}</Block>
      <Block title="For example">{card.example}</Block>

      {card.commonMisunderstanding && (
        <section className="rounded-xl bg-amber-50/70 px-4 py-3.5 ring-1 ring-amber-400/40 dark:bg-amber-950/25">
          <h3 className="text-[11px] font-semibold tracking-wide text-amber-800 uppercase dark:text-amber-300">
            Commonly misunderstood
          </h3>
          <p className="mt-1.5 text-[14px] leading-relaxed text-foreground/90">
            {card.commonMisunderstanding}
          </p>
        </section>
      )}

      {card.related.length > 0 && (
        <div className="px-1">
          <h3 className="text-[11px] font-semibold tracking-wide text-muted uppercase">
            Related
          </h3>
          <p className="mt-1 text-[13px] text-muted">{card.related.join(' · ')}</p>
        </div>
      )}

      <Link
        href={`/vocabulary/${card.slug}`}
        className="block px-1 text-[12px] font-medium text-accent hover:underline"
      >
        Open the full card
      </Link>
    </article>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface-raised px-4 py-3.5">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</h3>
      <p className="mt-1.5 text-[14px] leading-relaxed text-foreground/90">{children}</p>
    </section>
  )
}
