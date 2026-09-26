import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { CATEGORY_LABELS, getTerm } from '../../lib/vocab-queries'
import { STRENGTH_LABELS } from '../../lib/spaced-repetition'
import { DifficultButton, SaveButton } from '../../components/SaveButton'

export const dynamic = 'force-dynamic'

export async function generateMetadata(props: PageProps<'/vocabulary/[slug]'>): Promise<Metadata> {
  const { slug } = await props.params
  const term = await getTerm(slug)
  return { title: term ? term.term : 'Term not found' }
}

/**
 * A vocabulary card.
 *
 * Follows the brief's card structure in order, and the order is pedagogical:
 * definition, why it matters in GMS, a concrete example, then the common
 * misunderstanding. The misunderstanding comes last deliberately — it only
 * lands once you think you have understood the thing.
 *
 * "More formal source-based definition when available" is genuinely optional.
 * Where we do not have one, the card says so rather than dressing up the plain
 * definition in legal-sounding language, which would be inventing authority.
 */
export default async function TermPage(props: PageProps<'/vocabulary/[slug]'>) {
  const { slug } = await props.params
  const term = await getTerm(slug)
  if (!term) notFound()

  const strength = STRENGTH_LABELS[term.strength]

  return (
    <main className="flex-1 pb-8">
      <div className="px-4 pt-4">
        <Link href="/vocabulary" className="text-[13px] font-medium text-accent hover:underline">
          ← Vocabulary
        </Link>
      </div>

      <header className="px-4 pt-3 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] tracking-wide text-muted uppercase">
            {CATEGORY_LABELS[term.category]}
          </span>
          <span className={`text-[10px] font-medium ${strength.className}`}>{strength.label}</span>
        </div>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">{term.term}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-foreground/90">{term.definition}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <SaveButton
            entityType="vocab_term"
            entityId={term.id}
            initialSaved={term.saved}
            revalidate={`/vocabulary/${term.slug}`}
          />
          <DifficultButton
            termId={term.id}
            initialDifficult={term.markedDifficult}
            revalidate={`/vocabulary/${term.slug}`}
          />
        </div>
      </header>

      <div className="space-y-3 px-4">
        <Card title="Why it matters in global mobility">{term.whyItMatters}</Card>
        <Card title="For example">{term.example}</Card>

        {term.commonMisunderstanding && (
          <section className="rounded-xl bg-amber-50/70 px-4 py-3.5 ring-1 ring-amber-400/40 dark:bg-amber-950/25">
            <h2 className="text-[11px] font-semibold tracking-wide text-amber-800 uppercase dark:text-amber-300">
              Commonly misunderstood
            </h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-foreground/90">
              {term.commonMisunderstanding}
            </p>
          </section>
        )}

        {/* Formal definition, only where we actually have a source for one. */}
        {term.formalDefinition ? (
          <section className="rounded-xl border border-line bg-surface-raised px-4 py-3.5">
            <h2 className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              More formal definition
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/85">
              {term.formalDefinition}
            </p>
            {term.formalDefinitionSourceUrl && (
              <a
                href={term.formalDefinitionSourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-[11px] text-accent hover:underline"
              >
                Source ↗
              </a>
            )}
          </section>
        ) : (
          <p className="px-1 text-[11px] leading-relaxed text-muted italic">
            No formal source-based definition is recorded for this term yet. The explanation above is
            written for learning, not quoted from a tax authority.
          </p>
        )}

        {term.related.length > 0 && (
          <section>
            <h2 className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
              Related terms
            </h2>
            <ul className="space-y-2">
              {term.related.map((related) => (
                <li key={related.slug}>
                  <Link
                    href={`/vocabulary/${related.slug}`}
                    className="block rounded-xl border border-line bg-surface-raised px-4 py-3 transition-colors hover:border-accent/40"
                  >
                    <p className="text-[14px] font-semibold text-foreground">{related.term}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                      {related.definition}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Where this term shows up in the feed — the point of linking them. */}
        {term.appearsIn.length > 0 && (
          <section>
            <h2 className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
              Seen in these updates
            </h2>
            <ul className="space-y-2">
              {term.appearsIn.map((update) => (
                <li key={update.slug}>
                  <Link
                    href={`/updates/${update.slug}`}
                    className="block rounded-xl border border-line bg-surface-raised px-4 py-3 text-[13px] leading-snug font-medium text-accent transition-colors hover:border-accent/40"
                  >
                    {update.headline}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface-raised px-4 py-3.5">
      <h2 className="text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-foreground/90">{children}</p>
    </section>
  )
}
