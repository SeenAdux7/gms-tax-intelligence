import Link from 'next/link'
import type { Metadata } from 'next'
import {
  CATEGORY_LABELS,
  browseTerms,
  getVocabCategories,
  getVocabProgress,
  type VocabCategory,
} from '../lib/vocab-queries'
import { STRENGTH_LABELS } from '../lib/spaced-repetition'
import { EmptyState } from '../components/ui'

export const metadata: Metadata = { title: 'Vocabulary' }

/** Reads the database and reflects live review progress — never prerendered. */
export const dynamic = 'force-dynamic'

export default async function VocabularyPage(props: PageProps<'/vocabulary'>) {
  const params = await props.searchParams
  const search = typeof params.q === 'string' ? params.q : undefined
  const category =
    typeof params.category === 'string' ? (params.category as VocabCategory) : undefined

  const [terms, categories, progress] = await Promise.all([
    browseTerms({ search, category }),
    getVocabCategories(),
    getVocabProgress(),
  ])

  return (
    <main className="flex-1">
      <header className="px-4 pt-6 pb-3">
        <h1 className="text-2xl font-semibold tracking-tight">Vocabulary</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          The language of global mobility, in plain English — with an example and the mistake people
          usually make.
        </p>
      </header>

      {/* Progress. Three buckets, not a percentage — the data does not support
          implying that much precision. */}
      <div className="px-4 pb-4">
        <div className="flex gap-2">
          <Stat value={progress.known} label="Known" tone="text-emerald-700 dark:text-emerald-300" />
          <Stat value={progress.learning} label="Learning" tone="text-amber-700 dark:text-amber-300" />
          <Stat value={progress.notStarted} label="Not started" tone="text-muted" />
        </div>
      </div>

      {/* The three learning modes. Browse is this page. */}
      <div className="grid grid-cols-3 gap-2 px-4 pb-5">
        <ModeLink href="/vocabulary/learn" title="Learn" hint="Swipe a few cards" />
        <ModeLink href="/vocabulary/practice" title="Practice" hint="Test yourself" />
        <ModeLink
          href="/vocabulary/review"
          title="Review"
          hint={progress.needsReview > 0 ? `${progress.needsReview} due` : 'Nothing due'}
          highlight={progress.needsReview > 0}
        />
      </div>

      <form action="/vocabulary" className="px-4 pb-3">
        <label htmlFor="q" className="sr-only">
          Search terms
        </label>
        <div className="flex gap-2">
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={search ?? ''}
            placeholder="Search terms and definitions"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
          <button type="submit" className="rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white">
            Search
          </button>
        </div>
        {category && <input type="hidden" name="category" value={category} />}
      </form>

      <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-4">
        <Link
          href={search ? `/vocabulary?q=${encodeURIComponent(search)}` : '/vocabulary'}
          className={chipClass(!category)}
        >
          All {terms.length > 0 && !category && !search ? `(${terms.length})` : ''}
        </Link>
        {categories.map(({ category: cat, count }) => (
          <Link
            key={cat}
            href={`/vocabulary?category=${cat}${search ? `&q=${encodeURIComponent(search)}` : ''}`}
            className={chipClass(category === cat)}
          >
            {CATEGORY_LABELS[cat]} ({count})
          </Link>
        ))}
      </div>

      {terms.length === 0 ? (
        <EmptyState title="No terms match">
          Try a different search, or clear the category filter.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {terms.map((term) => {
            const strength = STRENGTH_LABELS[term.strength]
            return (
              <li key={term.slug}>
                <Link
                  href={`/vocabulary/${term.slug}`}
                  className="block px-4 py-3.5 transition-colors hover:bg-surface active:bg-surface"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-[15px] font-semibold">{term.term}</h2>
                    <span className={`shrink-0 text-[10px] font-medium ${strength.className}`}>
                      {strength.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">{term.definition}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span className="text-[10px] tracking-wide text-muted uppercase">
                      {CATEGORY_LABELS[term.category]}
                    </span>
                    {term.markedDifficult && (
                      <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
                        · marked difficult
                      </span>
                    )}
                    {term.saved && <span className="text-[10px] text-accent">· saved</span>}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}

function chipClass(active: boolean): string {
  return `shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium whitespace-nowrap ring-1 transition-colors ${
    active ? 'bg-accent text-white ring-accent' : 'bg-surface text-foreground/80 ring-line hover:ring-accent/50'
  }`
}

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="flex-1 rounded-xl border border-line bg-surface-raised px-3 py-2.5 text-center">
      <p className={`text-lg font-semibold ${tone}`}>{value}</p>
      <p className="text-[10px] tracking-wide text-muted uppercase">{label}</p>
    </div>
  )
}

function ModeLink({
  href,
  title,
  hint,
  highlight = false,
}: {
  href: string
  title: string
  hint: string
  highlight?: boolean
}) {
  return (
    <Link
      href={href}
      className={`rounded-xl px-3 py-3 text-center ring-1 transition-colors ${
        highlight
          ? 'bg-accent text-white ring-accent'
          : 'bg-surface-raised text-foreground ring-line hover:ring-accent/40'
      }`}
    >
      <span className="block text-[13px] font-semibold">{title}</span>
      <span className={`block text-[10px] ${highlight ? 'text-white/85' : 'text-muted'}`}>{hint}</span>
    </Link>
  )
}
