/**
 * Updates — the main current-events feed
 * ======================================
 *
 * "Each item should be readable in less than a minute at first glance, with
 * additional detail available when opened."
 *
 * So a card carries only what supports a decision to open it: headline, status,
 * where, when it bites, and a two-line plain-language summary. Topics, affected
 * populations, evidence quotes, and impact analysis all live on the detail page.
 *
 * Filters are URL state (`?jurisdiction=GB&status=proposed`) rather than
 * component state. That means a filtered feed is a shareable link, the back
 * button behaves, and the whole page can stay a server component.
 */

import Link from 'next/link'
import type { Metadata } from 'next'
import { getFeed, getFilterOptions, type FeedFilters } from '../lib/queries'
import {
  STATUS_LABELS,
  TOPIC_LABELS,
  formatDate,
  relativeToNow,
  shortJurisdiction,
  type DevelopmentStatus,
  type Topic,
} from '../lib/labels'
import {
  EmptyState,
  JurisdictionChips,
  SeedDataNotice,
  StatusBadge,
  VerificationBadge,
} from '../components/ui'

export const metadata: Metadata = {
  title: 'Updates',
  description: 'Recent tax, payroll, and policy developments affecting mobile employees.',
}

/** Normalises a query param that may arrive as a string, array, or undefined. */
function toArray(value: string | string[] | undefined): string[] {
  if (!value) return []
  return (Array.isArray(value) ? value : [value]).filter(Boolean)
}

export default async function UpdatesPage(props: PageProps<'/updates'>) {
  // Next.js 16: searchParams is a Promise and must be awaited.
  const params = await props.searchParams

  const filters: FeedFilters = {
    jurisdictions: toArray(params.jurisdiction),
    topics: toArray(params.topic) as Topic[],
    statuses: toArray(params.status) as DevelopmentStatus[],
    search: typeof params.q === 'string' ? params.q : undefined,
  }

  const [items, options] = await Promise.all([getFeed(filters), getFilterOptions()])
  const activeFilterCount =
    filters.jurisdictions!.length + filters.topics!.length + filters.statuses!.length

  return (
    <main className="flex-1">
      <header className="px-4 pt-6 pb-3">
        <h1 className="text-2xl font-semibold tracking-tight">Updates</h1>
        <p className="mt-1 text-[13px] text-muted">
          Developments that may affect mobile employees and the teams supporting them.
        </p>
      </header>

      {/* Search. A plain GET form, so it works without JavaScript and leaves a
          shareable URL behind. */}
      <form action="/updates" className="px-4 pb-3">
        <label htmlFor="q" className="sr-only">
          Search updates
        </label>
        <div className="flex gap-2">
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={filters.search ?? ''}
            placeholder="Search headlines and summaries"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white"
          >
            Search
          </button>
        </div>
        {/* Preserve active filters when searching. */}
        {filters.jurisdictions!.map((j) => (
          <input key={j} type="hidden" name="jurisdiction" value={j} />
        ))}
        {filters.topics!.map((t) => (
          <input key={t} type="hidden" name="topic" value={t} />
        ))}
        {filters.statuses!.map((s) => (
          <input key={s} type="hidden" name="status" value={s} />
        ))}
      </form>

      <FilterRail options={options} filters={filters} />

      {(activeFilterCount > 0 || filters.search) && (
        <div className="flex items-center justify-between px-4 pb-2">
          <p className="text-[12px] text-muted">
            {items.length} {items.length === 1 ? 'update' : 'updates'}
            {filters.search && <> matching &ldquo;{filters.search}&rdquo;</>}
          </p>
          <Link href="/updates" className="text-[12px] font-medium text-accent hover:underline">
            Clear all
          </Link>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState title="No updates match those filters">
          Try removing a filter, or clear them all to see the full feed.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/updates/${item.slug}`}
                className="block px-4 py-4 transition-colors hover:bg-surface active:bg-surface"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={item.status} size="sm" />
                  <JurisdictionChips codes={item.jurisdictionCodes} />
                  {item.isSeedData && <SeedDataNotice inline />}
                </div>

                <h2 className="text-[15px] leading-snug font-semibold text-foreground">
                  {item.headline}
                </h2>

                {item.summary && (
                  <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted">
                    {item.summary}
                  </p>
                )}

                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                  <VerificationBadge level={item.verification} />
                  {item.primaryTopic && <span>{TOPIC_LABELS[item.primaryTopic]}</span>}
                  <EffectiveHint effectiveAt={item.effectiveAt} publishedAt={item.publishedAt} />
                  {item.sourceCount > 0 && (
                    <span>
                      {item.sourceCount} {item.sourceCount === 1 ? 'source' : 'sources'}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

/**
 * The date line on a card.
 *
 * Shows the effective date when there is one, because that is what determines
 * urgency. When there isn't, it says so explicitly rather than quietly showing
 * the publication date in its place — substituting one date for another is the
 * exact confusion the brief warns against.
 */
function EffectiveHint({
  effectiveAt,
  publishedAt,
}: {
  effectiveAt: string | null
  publishedAt: string | null
}) {
  if (effectiveAt) {
    const relative = relativeToNow(effectiveAt)
    return (
      <span>
        Effective {formatDate(effectiveAt)}
        {relative && <span className="text-muted/80"> ({relative})</span>}
      </span>
    )
  }
  return (
    <span className="italic">
      No effective date stated
      {publishedAt && <span className="not-italic"> · published {formatDate(publishedAt)}</span>}
    </span>
  )
}

/**
 * One horizontally scrolling row of filter chips.
 *
 * Defined at module scope rather than inside `FilterRail`. A component created
 * during render is a new component type on every pass, so React unmounts and
 * remounts its whole subtree instead of updating it — which loses child state
 * and scroll position. It happens to be harmless here (server component, no
 * state), but the habit is the bug.
 */
function Rail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <p className="px-4 pb-1 text-[10px] font-semibold tracking-wide text-muted uppercase">
        {label}
      </p>
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-1">{children}</div>
    </div>
  )
}

function chipClass(active: boolean): string {
  return `shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium whitespace-nowrap ring-1 transition-colors ${
    active
      ? 'bg-accent text-white ring-accent'
      : 'bg-surface text-foreground/80 ring-line hover:ring-accent/50'
  }`
}

/**
 * The filter rails.
 *
 * Only offers values that actually appear in the feed (`getFilterOptions`), so
 * a filter can never return an empty list. Each chip is a link that toggles its
 * own value in the query string.
 */
function FilterRail({
  options,
  filters,
}: {
  options: Awaited<ReturnType<typeof getFilterOptions>>
  filters: FeedFilters
}) {
  const buildHref = (key: 'jurisdiction' | 'topic' | 'status', value: string) => {
    const next = new URLSearchParams()
    if (filters.search) next.set('q', filters.search)

    const current = {
      jurisdiction: filters.jurisdictions ?? [],
      topic: filters.topics ?? [],
      status: filters.statuses ?? [],
    }

    for (const [paramKey, values] of Object.entries(current)) {
      for (const v of values as string[]) {
        // Toggle: drop the value if it's the one being clicked.
        if (paramKey === key && v === value) continue
        next.append(paramKey, v)
      }
    }
    if (!(current[key] as string[]).includes(value)) next.append(key, value)

    const qs = next.toString()
    return qs ? `/updates?${qs}` : '/updates'
  }

  return (
    <div className="pb-1">
      <Rail label="Place">
        {options.jurisdictions.map((code) => (
          <Link
            key={code}
            href={buildHref('jurisdiction', code)}
            className={chipClass(filters.jurisdictions!.includes(code))}
          >
            {shortJurisdiction(code)}
          </Link>
        ))}
      </Rail>

      <Rail label="Stage">
        {options.statuses.map((status) => (
          <Link
            key={status}
            href={buildHref('status', status)}
            className={chipClass(filters.statuses!.includes(status))}
          >
            {STATUS_LABELS[status].label}
          </Link>
        ))}
      </Rail>

      <Rail label="Topic">
        {options.topics.map((topic) => (
          <Link
            key={topic}
            href={buildHref('topic', topic)}
            className={chipClass(filters.topics!.includes(topic))}
          >
            {TOPIC_LABELS[topic]}
          </Link>
        ))}
      </Rail>
    </div>
  )
}
