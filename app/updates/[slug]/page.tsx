/**
 * Update detail — Learn Mode and Professional Mode
 * ================================================
 *
 * The page is laid out in three clearly separated regions, in this order, and
 * the order is the point:
 *
 *   1. WHAT THE SOURCE SAYS   — facts, each with its verbatim quote, and each
 *                               missing fact stated as missing.
 *   2. WHAT WE THINK IT MEANS — AI interpretation, in visually distinct blocks,
 *                               every one labelled.
 *   3. SOURCES                — the documents themselves.
 *
 * Facts come first because interpretation should be read in light of evidence,
 * not the other way round. A reader who stops after region 1 has learned only
 * true things.
 *
 * Mode is URL state (`?mode=professional`), so the page stays a server
 * component, a given mode is linkable, and the back button works.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getDevelopment } from '../../lib/queries'
import { getTermsForDevelopment } from '../../lib/vocab-queries'
import { isSaved } from '../../lib/saved-queries'
import { SaveButton } from '../../components/SaveButton'
import {
  POPULATION_LABELS,
  STATUS_LABELS,
  STATUS_UNKNOWN,
  TOPIC_LABELS,
  VERIFICATION_LABELS,
  formatDate,
  shortJurisdiction,
  type InterpretationKind,
} from '../../lib/labels'
import {
  DateFactRow,
  EvidenceQuote,
  FactRow,
  InterpretationBlock,
  SeedDataNotice,
  StatusBadge,
  VerificationBadge,
} from '../../components/ui'

type Mode = 'learn' | 'professional'

/** Which interpretation sections each mode shows, in display order.
 *
 *  Learn Mode leads with plain language and puts the "what is still unknown"
 *  block high, because a beginner is the reader most likely to mistake an open
 *  question for a settled answer. Professional Mode leads with the regulatory
 *  summary and the actionable review areas. */
const MODE_SECTIONS: Record<Mode, InterpretationKind[]> = {
  learn: [
    'learn_summary',
    'employee_effect',
    'employer_effect',
    'gms_effect',
    'uncertainty',
    'review_actions',
  ],
  professional: [
    'professional_summary',
    'gms_effect',
    'review_actions',
    'employer_effect',
    'employee_effect',
    'uncertainty',
  ],
}

/**
 * Deliberately NOT using `generateStaticParams`.
 *
 * The page reads `searchParams` for the mode toggle, so it is dynamic anyway
 * and pre-rendering the slugs would buy nothing. It would also make the build
 * depend on a reachable database, which turns a transient database hiccup into
 * a failed deploy. Rendering per request keeps the build hermetic.
 */

export async function generateMetadata(props: PageProps<'/updates/[slug]'>): Promise<Metadata> {
  const { slug } = await props.params
  const development = await getDevelopment(slug)
  if (!development) return { title: 'Update not found' }
  return { title: development.headline }
}

export default async function UpdateDetailPage(props: PageProps<'/updates/[slug]'>) {
  // Next.js 16: both params and searchParams are Promises.
  const [{ slug }, search] = await Promise.all([props.params, props.searchParams])

  const development = await getDevelopment(slug)
  if (!development) notFound()

  const [terms, saved] = await Promise.all([
    getTermsForDevelopment(slug),
    isSaved('development', development.id),
  ])

  const mode: Mode = search.mode === 'professional' ? 'professional' : 'learn'

  const interpretationsByKind = new Map(development.interpretations.map((i) => [i.kind, i]))
  const sections = MODE_SECTIONS[mode]
    .map((kind) => interpretationsByKind.get(kind))
    .filter((i): i is NonNullable<typeof i> => Boolean(i))

  const statusMeta = development.facts.status.value
    ? STATUS_LABELS[development.facts.status.value]
    : STATUS_UNKNOWN

  const affected = development.jurisdictions.filter((j) => j.role === 'affected')
  const hosts = development.jurisdictions.filter((j) => j.role === 'host')
  const homes = development.jurisdictions.filter((j) => j.role === 'home')

  return (
    <main className="flex-1 pb-8">
      <div className="px-4 pt-4">
        <Link href="/updates" className="text-[13px] font-medium text-accent hover:underline">
          ← Updates
        </Link>
      </div>

      <header className="px-4 pt-3 pb-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={development.facts.status.value} />
          <VerificationBadge level={development.verification} />
          {/* No inline "Demo" chip here — the full notice appears a few lines
              below, and saying it twice in one screenful reads as clutter. */}
        </div>

        <h1 className="text-xl leading-snug font-semibold tracking-tight">
          {development.headline}
        </h1>

        {/* The status gloss, spelled out. A badge saying "Proposed" means
            nothing to a beginner without this sentence. */}
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{statusMeta.explain}</p>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {[...affected, ...hosts, ...homes]
            .map((j) => j.code)
            .filter((code, i, all) => all.indexOf(code) === i)
            .map((code) => (
              <span
                key={code}
                className="rounded-md bg-surface px-2 py-0.5 text-[11px] font-medium text-muted ring-1 ring-line"
              >
                {shortJurisdiction(code)}
              </span>
            ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <SaveButton
            entityType="development"
            entityId={development.id}
            initialSaved={saved}
            revalidate={`/updates/${slug}`}
          />
          <Link
            href={`/learn/${slug}`}
            className="inline-flex items-center rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white"
          >
            Take the lesson →
          </Link>
        </div>
      </header>

      <ModeToggle slug={slug} mode={mode} />

      {development.isSeedData && (
        <div className="px-4 pb-4">
          <SeedDataNotice />
        </div>
      )}

      {/* ================================================================
          REGION 1 — what the source actually says
          ================================================================ */}
      <section className="px-4 pb-6">
        <SectionHeading
          title="What the source says"
          note="Facts taken directly from the source document. Tap “Show the source” to read the exact wording."
        />

        <dl className="rounded-xl border border-line bg-surface-raised px-4">
          <FactRow
            label="Stage in the legal process"
            fact={development.facts.status}
            render={(value) => STATUS_LABELS[value as keyof typeof STATUS_LABELS].label}
            absenceNote="Without a clear stage, treat this as something to monitor rather than act on."
          />
          <DateFactRow
            label="Published"
            fact={development.facts.publishedAt}
            absenceNote="The source carries no publication date. We do not substitute the date we retrieved it."
          />
          <DateFactRow
            label="Takes effect"
            fact={development.facts.effectiveAt}
            showRelative
            absenceNote="The source announces no effective date. It is not known whether this applies now or only in future — which is itself worth knowing."
          />
          <DateFactRow
            label="Action deadline"
            fact={development.facts.actionDeadlineAt}
            showRelative
            absenceNote="No deadline is stated in the source."
          />
          <FactRow
            label="Main topic"
            fact={development.facts.primaryTopic}
            render={(value) => TOPIC_LABELS[value as keyof typeof TOPIC_LABELS]}
          />
        </dl>

        {/* Affected populations, each with the sentence that put them there. */}
        {development.populations.length > 0 && (
          <div className="mt-4 rounded-xl border border-line bg-surface-raised p-4">
            <h3 className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              Who may be affected
            </h3>
            <ul className="mt-2 space-y-2.5">
              {development.populations.map((p) => (
                <li key={p.population}>
                  <span className="text-sm text-foreground">
                    {POPULATION_LABELS[p.population]}
                  </span>
                  {p.quote && (
                    <EvidenceQuote
                      quote={p.quote}
                      sourceUrl={development.documents[0]?.url ?? '#'}
                      sourceTitle={development.documents[0]?.title}
                      publisher={development.documents[0]?.publisher}
                      label="Why this population"
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {development.topics.length > 1 && (
          <div className="mt-4">
            <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
              Areas touched
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {development.topics.map((t) => (
                <span
                  key={t.topic}
                  className="rounded-md bg-surface px-2 py-1 text-[12px] text-foreground/80 ring-1 ring-line"
                >
                  {TOPIC_LABELS[t.topic]}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ================================================================
          REGION 2 — interpretation, clearly marked as such
          ================================================================ */}
      <section className="px-4 pb-6">
        <SectionHeading
          title={mode === 'learn' ? 'What it might mean' : 'Assignment and compliance implications'}
          note="Written by the app, not by the source. These are possible effects, not conclusions — and not advice."
        />

        {development.uncertaintyNote && (
          <div className="mb-3 rounded-lg bg-amber-50/70 px-3 py-2.5 text-[13px] leading-relaxed text-amber-900 ring-1 ring-amber-400/40 dark:bg-amber-950/30 dark:text-amber-100">
            <strong className="font-semibold">Read with care. </strong>
            {development.uncertaintyNote}
          </div>
        )}

        <div className="space-y-3">
          {sections.map((section) => (
            <InterpretationBlock
              key={section.kind}
              kind={section.kind}
              body={section.body}
              model={section.model}
              isUncertain={section.isUncertain}
              editedByUser={section.editedByUser}
            />
          ))}
        </div>

        {/* The quotes the interpretation above rests on.
            Collapsed by default so it doesn't crowd the screen, but present on
            every development — an interpretation a reader cannot check against
            the source is exactly the thing this product is trying not to be. */}
        {development.interpretationEvidence.length > 0 && (
          <details className="group mt-4 rounded-xl border border-line bg-surface-raised px-4 py-3">
            <summary className="cursor-pointer list-none text-[13px] font-medium text-accent">
              <span className="group-open:hidden">
                What this is based on ({development.interpretationEvidence.length} quotes)
              </span>
              <span className="hidden group-open:inline">Hide the quotes</span>
            </summary>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              The sections above reason from these passages. Anything not supported by them is
              flagged as uncertain.
            </p>
            <ul className="mt-3 space-y-3">
              {development.interpretationEvidence.map((e) => (
                <li
                  key={e.quote}
                  className="border-l-2 border-accent/40 pl-3 text-[13px] leading-relaxed text-foreground/85"
                >
                  &ldquo;{e.quote}&rdquo;
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* ================================================================
          REGION 3 — the documents
          ================================================================ */}
      <section className="px-4">
        <SectionHeading
          title={development.documents.length === 1 ? 'Source' : 'Sources'}
          note="Every fact above is drawn from these documents."
        />

        <ul className="space-y-2">
          {development.documents.map((doc) => (
            <li
              key={doc.url}
              className="rounded-xl border border-line bg-surface-raised p-3.5"
            >
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="rounded bg-foreground/8 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted uppercase">
                  {doc.sourceTier === 'primary_official'
                    ? 'Official source'
                    : doc.sourceTier === 'professional'
                      ? 'Professional publication'
                      : 'Press'}
                </span>
                {doc.role !== 'primary' && (
                  <span className="text-[10px] tracking-wide text-muted uppercase">{doc.role}</span>
                )}
              </div>
              <a
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-accent hover:underline"
              >
                {doc.title ?? doc.url} ↗
              </a>
              <p className="mt-1 text-[11px] text-muted">
                {doc.sourceName}
                {doc.publishedAt && <> · published {formatDate(doc.publishedAt)}</>}
                <> · retrieved {formatDate(doc.retrievedAt)}</>
              </p>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-[11px] leading-relaxed text-muted">
          Confidence in this characterisation: <strong>{development.confidence}</strong>.{' '}
          {VERIFICATION_LABELS[development.verification].explain}
        </p>
      </section>

      {/* Tappable vocabulary. "Terms mentioned in an update should be tappable
          and linked to their vocabulary cards." Placed after the sources rather
          than inline in the prose: inline links would turn a two-paragraph
          summary into a field of blue, which fights the brief's insistence on
          an uncluttered surface. */}
      {terms.length > 0 && (
        <section className="px-4 pt-7">
          <SectionHeading
            title="Terms worth knowing"
            note="The language this update uses, explained plainly."
          />
          <ul className="space-y-2">
            {terms.map((term) => (
              <li key={term.slug}>
                <Link
                  href={`/vocabulary/${term.slug}`}
                  className="block rounded-xl border border-line bg-surface-raised px-4 py-3 transition-colors hover:border-accent/40"
                >
                  <p className="text-[14px] font-semibold text-foreground">{term.term}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{term.definition}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
      <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{note}</p>
    </div>
  )
}

/**
 * Learn Mode / Professional Mode switch.
 *
 * Two links rather than a button, so the current mode is a real URL. Learn Mode
 * is the default per the brief ("This is the default mode for a beginner").
 */
function ModeToggle({ slug, mode }: { slug: string; mode: Mode }) {
  const option = (value: Mode, label: string, hint: string) => {
    const active = mode === value
    return (
      <Link
        href={value === 'learn' ? `/updates/${slug}` : `/updates/${slug}?mode=professional`}
        aria-current={active ? 'true' : undefined}
        className={`flex-1 rounded-lg px-3 py-2 text-center transition-colors ${
          active ? 'bg-accent text-white' : 'text-foreground/70 hover:bg-surface'
        }`}
      >
        <span className="block text-[13px] font-medium">{label}</span>
        <span className={`block text-[10px] ${active ? 'text-white/80' : 'text-muted'}`}>
          {hint}
        </span>
      </Link>
    )
  }

  return (
    <div className="px-4 pb-5">
      <div className="flex gap-1 rounded-xl border border-line bg-surface p-1">
        {option('learn', 'Learn', 'Plain language')}
        {option('professional', 'Professional', 'Concise & technical')}
      </div>
    </div>
  )
}
