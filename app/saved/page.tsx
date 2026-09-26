import Link from 'next/link'
import type { Metadata } from 'next'
import {
  getMissedQuestions,
  getReviewDueCount,
  getSavedTerms,
  getSavedUpdates,
} from '../lib/saved-queries'
import { STRENGTH_LABELS } from '../lib/spaced-repetition'
import { formatDate } from '../lib/labels'
import { StatusBadge } from '../components/ui'

export const metadata: Metadata = { title: 'Saved' }
export const dynamic = 'force-dynamic'

/**
 * Saved — "bookmarked updates, difficult terms, incorrect answers, and items
 * selected for later review."
 *
 * Four groups rather than one merged list, because they are things you come
 * back to for different reasons: a bookmarked update is "read this properly
 * later"; a difficult term is "I keep forgetting this"; a missed question is
 * "I reasoned about this badly". Flattening them into one feed would lose the
 * reason, which is the useful part.
 */
export default async function SavedPage() {
  const [updates, terms, missed, dueCount] = await Promise.all([
    getSavedUpdates(),
    getSavedTerms(),
    getMissedQuestions(),
    getReviewDueCount(),
  ])

  const bookmarkedTerms = terms.filter((t) => t.bookmarked)
  const difficultTerms = terms.filter((t) => t.markedDifficult)
  const isEmpty =
    updates.length === 0 && terms.length === 0 && missed.length === 0

  return (
    <main className="flex-1 pb-8">
      <header className="px-4 pt-6 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Saved</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Things you have kept, flagged, or got wrong — gathered for another look.
        </p>
      </header>

      {isEmpty && (
        <div className="px-4">
          <div className="rounded-xl border border-line bg-surface-raised p-5 text-center">
            <h2 className="text-[15px] font-semibold">Nothing saved yet</h2>
            <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-muted">
              Bookmark an update, flag a term you find hard, or answer a lesson question wrong, and
              it will show up here.
            </p>
            <div className="mt-5 space-y-2">
              <Link
                href="/updates"
                className="block rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-white"
              >
                Browse updates
              </Link>
              <Link
                href="/vocabulary"
                className="block rounded-lg bg-surface px-4 py-2.5 text-[13px] font-medium text-accent ring-1 ring-line"
              >
                Browse vocabulary
              </Link>
            </div>
          </div>
        </div>
      )}

      {dueCount > 0 && (
        <div className="px-4 pb-5">
          <Link
            href="/vocabulary/review"
            className="block rounded-xl bg-accent px-4 py-3.5 text-center text-white"
          >
            <span className="block text-[14px] font-semibold">
              {dueCount} {dueCount === 1 ? 'term' : 'terms'} ready for review
            </span>
            <span className="block text-[11px] text-white/85">
              Weaker terms come back more often
            </span>
          </Link>
        </div>
      )}

      {updates.length > 0 && (
        <Section title="Bookmarked updates" count={updates.length}>
          <ul className="divide-y divide-line">
            {updates.map((update) => (
              <li key={update.slug}>
                <Link
                  href={`/updates/${update.slug}`}
                  className="block px-4 py-3.5 transition-colors hover:bg-surface"
                >
                  <div className="mb-1.5">
                    <StatusBadge status={update.status} size="sm" />
                  </div>
                  <p className="text-[14px] leading-snug font-semibold">{update.headline}</p>
                  <p className="mt-1 text-[10px] text-muted">
                    Saved {formatDate(update.savedAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {difficultTerms.length > 0 && (
        <Section title="Terms you find difficult" count={difficultTerms.length}>
          <ul className="divide-y divide-line">
            {difficultTerms.map((term) => (
              <li key={term.slug}>
                <TermRow term={term} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {bookmarkedTerms.length > 0 && (
        <Section title="Saved terms" count={bookmarkedTerms.length}>
          <ul className="divide-y divide-line">
            {bookmarkedTerms.map((term) => (
              <li key={term.slug}>
                <TermRow term={term} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Missed questions, with the answer that was actually right. Showing the
          question without the answer would make this a list of reproaches. */}
      {missed.length > 0 && (
        <Section title="Questions you got wrong" count={missed.length}>
          <ul className="divide-y divide-line">
            {missed.map((question) => (
              <li key={`${question.developmentSlug}-${question.prompt}`} className="px-4 py-3.5">
                <p className="text-[13px] leading-snug font-medium">{question.prompt}</p>
                <div className="mt-2 rounded-lg bg-emerald-500/10 px-3 py-2 ring-1 ring-emerald-500/25">
                  <p className="text-[10px] font-semibold tracking-wide text-emerald-800 uppercase dark:text-emerald-300">
                    Strongest answer
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-foreground/85">
                    {question.correctLabel}
                  </p>
                </div>
                <Link
                  href={`/learn/${question.developmentSlug}`}
                  className="mt-2 inline-block text-[11px] font-medium text-accent hover:underline"
                >
                  Retake this lesson
                </Link>
              </li>
            ))}
          </ul>
          <p className="px-4 pt-3 text-[11px] leading-relaxed text-muted">
            Only your most recent attempt at each question counts, so answering correctly later
            clears it from this list.
          </p>
        </Section>
      )}
    </main>
  )
}

function Section({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <section className="pb-6">
      <div className="flex items-baseline justify-between px-4 pb-2">
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
        <span className="text-[11px] text-muted">{count}</span>
      </div>
      <div className="border-t border-line">{children}</div>
    </section>
  )
}

function TermRow({
  term,
}: {
  term: { slug: string; term: string; definition: string; strength: 'new' | 'learning' | 'known' }
}) {
  const strength = STRENGTH_LABELS[term.strength]
  return (
    <Link
      href={`/vocabulary/${term.slug}`}
      className="block px-4 py-3.5 transition-colors hover:bg-surface"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[14px] font-semibold">{term.term}</p>
        <span className={`shrink-0 text-[10px] font-medium ${strength.className}`}>
          {strength.label}
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">{term.definition}</p>
    </Link>
  )
}
