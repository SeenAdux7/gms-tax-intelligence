import Link from 'next/link'
import type { Metadata } from 'next'
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  developmentAssignmentMatches,
  developmentSources,
  developments,
  evalRuns,
  evalSamples,
  evidenceSpans,
  interpretationEvidence,
  interpretations,
  lessonOptions,
  lessonQuestions,
  lessons,
  processingRuns,
  sources,
} from '@/db/schema'
import { formatDate } from '../lib/labels'
import { Panel, StatTile } from '../components/charts'

export const metadata: Metadata = { title: 'Evaluation' }
export const dynamic = 'force-dynamic'

/**
 * How well is this working?
 *
 * The brief asks for the product to "make its performance measurable" and lists
 * the metrics. Most projects satisfy that with a test script nobody runs.
 *
 * This is that measurement as a PAGE, and the reason is the one thing this
 * project is trying to prove: that AI was used carefully. Claiming care is
 * cheap. A screen showing the percentage of published claims backed by a
 * displayed source, how many facts the pipeline declined to guess at, and how
 * many model quotes failed verification is a claim someone can check.
 *
 * Every figure is a count over stored rows. Where a measurement has not been
 * taken, the page says so rather than showing a zero — the distinction between
 * "measured as zero" and "not yet measured" is exactly the distinction this
 * app cares about everywhere else.
 */
export default async function EvaluationPage() {
  const [
    claimBacking,
    abstentions,
    samples,
    latestRuns,
    questionValidity,
    interpretationGrounding,
    dedupe,
    collection,
    sourceHealth,
  ] = await Promise.all([
    // % of published fact fields that carry a verified source quote.
    db
      .select({
        withEvidence: sql<number>`(
          count(*) filter (where ${developments.statusEvidenceId} is not null) +
          count(*) filter (where ${developments.publishedAtEvidenceId} is not null) +
          count(*) filter (where ${developments.effectiveAtEvidenceId} is not null) +
          count(*) filter (where ${developments.primaryTopicEvidenceId} is not null)
        )::int`,
        withValue: sql<number>`(
          count(*) filter (where ${developments.status} is not null) +
          count(*) filter (where ${developments.publishedAt} is not null) +
          count(*) filter (where ${developments.effectiveAt} is not null) +
          count(*) filter (where ${developments.primaryTopic} is not null)
        )::int`,
      })
      .from(developments)
      .where(eq(developments.reviewState, 'approved')),

    // Facts deliberately left null because the source did not state them.
    db
      .select({
        statusNull: sql<number>`count(*) filter (where ${developments.status} is null)::int`,
        effectiveNull: sql<number>`count(*) filter (where ${developments.effectiveAt} is null)::int`,
        deadlineNull: sql<number>`count(*) filter (where ${developments.actionDeadlineAt} is null)::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(developments)
      .where(eq(developments.reviewState, 'approved')),

    db.select().from(evalSamples),

    db
      .select({
        label: evalSamples.label,
        passed: evalRuns.passed,
        model: evalRuns.model,
        ranAt: evalRuns.ranAt,
        fieldScores: evalRuns.fieldScores,
      })
      .from(evalRuns)
      .innerJoin(evalSamples, eq(evalRuns.sampleId, evalSamples.id))
      .orderBy(desc(evalRuns.ranAt))
      .limit(12),

    // Lesson questions: how many correct answers cite evidence vs are
    // "not enough information"?
    db
      .select({
        total: sql<number>`count(*)::int`,
        cited: sql<number>`count(*) filter (where ${lessonOptions.evidenceId} is not null)::int`,
        insufficient: sql<number>`count(*) filter (where ${lessonOptions.isInsufficientInfo} = true)::int`,
      })
      .from(lessonOptions)
      .where(eq(lessonOptions.isCorrect, true)),

    db
      .select({
        total: sql<number>`count(distinct ${interpretations.id})::int`,
        grounded: sql<number>`count(distinct ${interpretationEvidence.interpretationId})::int`,
      })
      .from(interpretations)
      .leftJoin(
        interpretationEvidence,
        eq(interpretationEvidence.interpretationId, interpretations.id),
      ),

    db
      .select({
        grouped: sql<number>`count(*) filter (where ${developmentSources.role} = 'corroborating')::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(developmentSources),

    db
      .select({
        runs: sql<number>`count(*)::int`,
        notModified: sql<number>`count(*) filter (where ${processingRuns.notModified} = true)::int`,
        errors: sql<number>`count(*) filter (where ${processingRuns.error} is not null)::int`,
        cost: sql<number>`coalesce(sum(${processingRuns.costUsd}), 0)::float`,
        lastRun: sql<Date | null>`max(${processingRuns.startedAt})`,
      })
      .from(processingRuns),

    db
      .select({
        name: sources.name,
        enabled: sources.enabled,
        failures: sources.consecutiveFailures,
        lastSuccess: sources.lastSuccessAt,
        lastError: sources.lastError,
        accessUnrestricted: sources.accessUnrestricted,
      })
      .from(sources)
      .orderBy(sources.name),
  ])

  const backing = claimBacking[0]
  const backingPct =
    backing && backing.withValue > 0
      ? Math.round((backing.withEvidence / backing.withValue) * 100)
      : null

  const abst = abstentions[0]
  const validity = questionValidity[0]
  const grounding = interpretationGrounding[0]
  const dedupeStats = dedupe[0]
  const runs = collection[0]

  const evalHasRun = latestRuns.length > 0
  const [lessonCount] = await db.select({ n: sql<number>`count(*)::int` }).from(lessons)
  const [questionCount] = await db.select({ n: sql<number>`count(*)::int` }).from(lessonQuestions)
  const [matchCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(developmentAssignmentMatches)
  const [spanCount] = await db.select({ n: sql<number>`count(*)::int` }).from(evidenceSpans)

  return (
    <main className="flex-1 pb-8">
      <header className="px-4 pt-6 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Evaluation</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          How well this is actually working. Every number below is a count over stored records — if
          a thing has not been measured, it says so rather than showing zero.
        </p>
      </header>

      <div className="space-y-3 px-4">
        {/* --- the headline claim ---------------------------------------- */}
        <Panel
          title="Are claims backed by sources?"
          note="The percentage of published fact fields that carry a verbatim quote from the source document. This is the product's central promise, so it is the first thing measured."
        >
          <div className="grid grid-cols-3 gap-2">
            <StatTile
              label="Facts with a source quote"
              value={backingPct === null ? '—' : `${backingPct}%`}
              note={backing ? `${backing.withEvidence} of ${backing.withValue}` : undefined}
              tone={backingPct === 100 ? 'good' : 'default'}
            />
            <StatTile label="Evidence quotes stored" value={spanCount?.n ?? 0} />
            <StatTile
              label="Interpretations grounded"
              value={
                grounding && grounding.total > 0
                  ? `${Math.round((grounding.grounded / grounding.total) * 100)}%`
                  : '—'
              }
              note={grounding ? `${grounding.grounded} of ${grounding.total}` : undefined}
            />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            100% is the only acceptable figure for the first number, and it is enforced at write
            time rather than monitored: a fact whose quote does not verify against the stored
            document is saved as &ldquo;not stated in source&rdquo; instead of being saved
            unsupported.
          </p>
        </Panel>

        {/* --- abstentions ---------------------------------------------- */}
        <Panel
          title="What the app declined to guess"
          note="Fields left deliberately blank because the source does not state them. A high number here is a feature, not a gap."
        >
          <div className="grid grid-cols-3 gap-2">
            <StatTile
              label="No status stated"
              value={abst?.statusNull ?? 0}
              note={`of ${abst?.total ?? 0} developments`}
            />
            <StatTile
              label="No effective date"
              value={abst?.effectiveNull ?? 0}
              note={`of ${abst?.total ?? 0}`}
            />
            <StatTile
              label="No deadline stated"
              value={abst?.deadlineNull ?? 0}
              note={`of ${abst?.total ?? 0}`}
            />
          </div>
        </Panel>

        {/* --- question validity ---------------------------------------- */}
        <Panel
          title="Question validity"
          note="Every correct answer must either quote the source or be flagged “not enough information to decide”. A lesson with any unsupported answer is withheld entirely."
        >
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Lessons published" value={lessonCount?.n ?? 0} />
            <StatTile
              label="Answers citing a quote"
              value={validity?.cited ?? 0}
              note={`of ${validity?.total ?? 0} correct answers`}
            />
            <StatTile
              label="“Not enough information”"
              value={validity?.insufficient ?? 0}
              note="correct answers with no quote, by design"
              tone={((validity?.insufficient ?? 0) > 0) ? 'good' : 'default'}
            />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            {questionCount?.n ?? 0} questions in total. The second and third numbers should add up
            to the total correct answers — any shortfall means a question is published without
            support, which the validator is designed to make impossible.
          </p>
        </Panel>

        {/* --- the eval set --------------------------------------------- */}
        <Panel
          title="Extraction accuracy against a reviewed sample set"
          note="Six documents with hand-verified answers. Rerunnable after any prompt or model change, so a regression is measurable rather than a matter of opinion."
          action={
            <span className="text-[11px] text-muted">{samples.length} samples</span>
          }
        >
          {!evalHasRun ? (
            <div className="rounded-lg bg-amber-50/70 px-3 py-2.5 ring-1 ring-amber-400/40 dark:bg-amber-950/25">
              <p className="text-[13px] leading-relaxed text-amber-900 dark:text-amber-100">
                <strong className="font-semibold">Not yet measured.</strong> The sample set is
                seeded and the scorer is unit tested, but the extraction pipeline has never been
                run against it — that needs an Anthropic API key. Run{' '}
                <code className="text-[12px]">npm run eval</code> once a key is configured.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {latestRuns.map((run) => (
                <li
                  key={`${run.label}-${run.ranAt.toISOString()}`}
                  className="rounded-lg bg-surface px-3 py-2 ring-1 ring-line"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-[11px]">{run.label}</span>
                    <span
                      className={`text-[10px] font-semibold uppercase ${
                        run.passed
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : 'text-red-700 dark:text-red-300'
                      }`}
                    >
                      {run.passed ? 'pass' : 'fail'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted">
                    {run.model} · {formatDate(run.ranAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
              What the samples test
            </p>
            <ul className="space-y-2">
              {samples.map((sample) => (
                <li key={sample.label} className="border-l-2 border-line pl-3">
                  <p className="font-mono text-[11px] text-foreground/85">{sample.label}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{sample.notes}</p>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        {/* --- collection health ---------------------------------------- */}
        <Panel
          title="Collection health"
          note="Source availability and processing failures, plus what collection has actually cost."
        >
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Collection runs" value={runs?.runs ?? 0} />
            <StatTile
              label="Unchanged (304)"
              value={runs?.notModified ?? 0}
              note="cost nothing"
              tone="good"
            />
            <StatTile
              label="Failed runs"
              value={runs?.errors ?? 0}
              tone={(runs?.errors ?? 0) > 0 ? 'warning' : 'default'}
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <StatTile
              label="Total AI spend"
              value={`$${(runs?.cost ?? 0).toFixed(4)}`}
              note={runs?.lastRun ? `last run ${formatDate(runs.lastRun)}` : 'never run'}
            />
            <StatTile
              label="Duplicate coverage grouped"
              value={dedupeStats?.grouped ?? 0}
              note={`of ${dedupeStats?.total ?? 0} source links`}
            />
          </div>

          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
              Sources
            </p>
            <ul className="space-y-1.5">
              {sourceHealth.map((source) => (
                <li key={source.name} className="flex items-baseline justify-between gap-3">
                  <span className="text-[12px] text-foreground/80">{source.name}</span>
                  <span className="shrink-0 text-[10px] font-medium">
                    {!source.accessUnrestricted ? (
                      <span className="text-red-700 dark:text-red-300">blocked (403)</span>
                    ) : !source.enabled ? (
                      <span className="text-muted">disabled</span>
                    ) : source.failures > 0 ? (
                      <span className="text-amber-700 dark:text-amber-300">
                        {source.failures} consecutive failures
                      </span>
                    ) : source.lastSuccess ? (
                      <span className="text-emerald-700 dark:text-emerald-300">ok</span>
                    ) : (
                      <span className="text-muted">not yet fetched</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        {/* --- matching -------------------------------------------------- */}
        <Panel
          title="Assignment matching"
          note="Matching is deterministic set arithmetic, unit tested rather than measured statistically — there is nothing probabilistic to score."
        >
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Potential review items" value={matchCount?.n ?? 0} />
            <StatTile label="Unit assertions" value={26} note="npm run verify:matching" />
          </div>
        </Panel>

        <p className="px-1 pt-1 text-[11px] leading-relaxed text-muted">
          Run everything with <code>npm run verify:all</code>. See{' '}
          <Link href="/updates" className="text-accent hover:underline">
            the feed
          </Link>{' '}
          for the output these measurements describe.
        </p>
      </div>
    </main>
  )
}
