import Link from 'next/link'
import type { Metadata } from 'next'
import {
  getAlertsByTopic,
  getComplianceSummary,
  getDevelopmentCounts,
  getDevelopmentsByJurisdiction,
  getDevelopmentsByStatus,
  getDevelopmentsByTopic,
  getLearningProgress,
  getUpcomingEffectiveDates,
  getWeakestTopics,
} from '../lib/dashboard-queries'
import { getTopCorridors, getUpcomingDeadlines, COMPLIANCE_STATUS_LABELS } from '../lib/assignment-queries'
import {
  STATUS_LABELS,
  TOPIC_LABELS,
  formatDate,
  relativeToNow,
  shortJurisdiction,
} from '../lib/labels'
import { BarChart, HeroFigure, LifecycleBar, Meter, Panel, StatTile } from '../components/charts'
import { StatusBadge } from '../components/ui'

export const metadata: Metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

/**
 * Dashboard.
 *
 * "The dashboard should present useful information without becoming a crowded
 * enterprise system." So the layout is ordered by what a reader would ask
 * first, and several things the brief lists are rendered as numbers or lists
 * rather than charts — a one-bar bar chart is worse than a stat tile, and six
 * upcoming dates are a list, not a timeline.
 *
 * Every figure is a count or a date comparison computed in SQL. Nothing here is
 * generated, which matters most on this screen: a number with no source looks
 * authoritative by default.
 */
export default async function DashboardPage() {
  const [
    counts,
    byJurisdiction,
    byTopic,
    byStatus,
    upcomingEffective,
    learning,
    weakTopics,
    compliance,
    alerts,
    corridors,
    deadlines,
  ] = await Promise.all([
    getDevelopmentCounts(),
    getDevelopmentsByJurisdiction(),
    getDevelopmentsByTopic(),
    getDevelopmentsByStatus(),
    getUpcomingEffectiveDates(6),
    getLearningProgress(),
    getWeakestTopics(4),
    getComplianceSummary(),
    getAlertsByTopic(),
    getTopCorridors(5),
    getUpcomingDeadlines(6),
  ])

  const accuracy = learning.questions.accuracy

  return (
    <main className="flex-1 pb-8">
      <header className="px-4 pt-6 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          What is in the feed, who it might touch, and how your learning is going.
        </p>
      </header>

      <div className="space-y-3 px-4">
        {/* Exactly one hero figure per view. This is the number the whole
            product exists to produce: records a professional may need to look
            at, drawn from current developments. */}
        <HeroFigure
          value={compliance.matches.total}
          label="potential review items"
          note={`Across ${compliance.matches.affectedAssignments} of ${compliance.population.total} synthetic assignments. Potential review items, not determinations.`}
        />

        {/* --- what's in the feed ------------------------------------- */}
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Developments tracked" value={counts.total} />
          <StatTile
            label="Not yet law"
            value={counts.notYetLaw}
            note="Discussion or proposed"
            tone={counts.notYetLaw > 0 ? 'warning' : 'default'}
          />
          <StatTile label="Enacted or in effect" value={counts.settled} tone="good" />
        </div>

        <Panel
          title="Where the feed sits in the legal process"
          note="A proposal is not a law. This is the split the brief asks to keep visible, shown light to dark as certainty increases."
        >
          <LifecycleBar
            data={byStatus.ordered.map((s) => ({
              label: STATUS_LABELS[s.status].label,
              value: s.count,
            }))}
            unknown={byStatus.unknown}
          />
        </Panel>

        {/* The absence of a date is itself a finding, so it gets a tile
            rather than being quietly omitted from the timeline below. */}
        {counts.noEffectiveDate > 0 && (
          <div className="rounded-xl bg-amber-50/70 px-4 py-3 ring-1 ring-amber-400/40 dark:bg-amber-950/25">
            <p className="text-[13px] leading-relaxed text-amber-900 dark:text-amber-100">
              <strong className="font-semibold">
                {counts.noEffectiveDate} of {counts.total} developments announce no effective date.
              </strong>{' '}
              They cannot appear in the timeline below, and it is not known whether they apply yet.
            </p>
          </div>
        )}

        <Panel
          title="Developments by place"
          note="A development affecting several places is counted in each."
        >
          <BarChart
            data={byJurisdiction.map((j) => ({
              label: shortJurisdiction(j.code),
              value: j.count,
            }))}
          />
        </Panel>

        <Panel
          title="Developments by topic"
          note="Most developments touch several topics, so these add up to more than the total above."
        >
          <BarChart
            data={byTopic.map((t) => ({ label: TOPIC_LABELS[t.topic], value: t.count }))}
          />
        </Panel>

        {/* --- what's coming ------------------------------------------ */}
        <Panel
          title="Coming into effect"
          note="Only developments with a stated effective date, soonest first."
          action={
            <Link href="/updates" className="text-[11px] font-medium text-accent hover:underline">
              All updates
            </Link>
          }
        >
          {upcomingEffective.length === 0 ? (
            <p className="text-[12px] text-muted">
              Nothing in the feed has a future effective date.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {upcomingEffective.map((item) => (
                <li key={item.slug}>
                  <Link href={`/updates/${item.slug}`} className="block group">
                    <div className="mb-1 flex items-center gap-2">
                      <StatusBadge status={item.status} size="sm" />
                      <span className="text-[11px] font-medium text-muted">
                        {formatDate(item.effectiveAt)} · {relativeToNow(item.effectiveAt)}
                      </span>
                    </div>
                    <p className="text-[13px] leading-snug font-medium text-foreground group-hover:text-accent">
                      {item.headline}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* --- the synthetic workforce -------------------------------- */}
        <Panel
          title="Synthetic workforce"
          note="Invented assignments, used to show how a development connects to real records."
          action={
            <Link href="/assignments" className="text-[11px] font-medium text-accent hover:underline">
              Browse
            </Link>
          }
        >
          <div className="mb-4 grid grid-cols-3 gap-2">
            <StatTile label="Assignments" value={compliance.population.total} />
            <StatTile label="Active" value={compliance.population.active} />
            <StatTile label="Planned" value={compliance.population.planned} />
          </div>

          <div className="space-y-3">
            <Meter
              label="Assignments with a flagged development"
              value={compliance.matches.affectedAssignments}
              total={compliance.population.total}
            />
            <Meter
              label="Compliance items still open"
              value={compliance.deadlines.open + compliance.deadlines.underReview + compliance.deadlines.overdue}
              total={compliance.deadlines.total}
              tone={compliance.deadlines.overdue > 0 ? 'warning' : 'accent'}
            />
          </div>

          {compliance.deadlines.overdue > 0 && (
            <p className="mt-3 text-[12px] font-medium text-red-700 dark:text-red-300">
              {compliance.deadlines.overdue} overdue{' '}
              {compliance.deadlines.overdue === 1 ? 'item' : 'items'}
            </p>
          )}
        </Panel>

        {corridors.length > 0 && (
          <Panel title="Busiest corridors">
            <BarChart
              data={corridors.map((c) => ({
                label: `${shortJurisdiction(c.home)} → ${shortJurisdiction(c.host)}`,
                value: c.count,
              }))}
            />
          </Panel>
        )}

        {alerts.length > 0 && (
          <Panel
            title="Review items by topic"
            /* These deliberately sum to more than the hero figure: a single
               review item is counted under every topic its development
               touches. Without saying so, a reader sees 16 withholding items
               against a total of 20 and reasonably concludes the numbers are
               wrong. */
            note={`Which kind of issue is raising review items. An item counts under every topic its development touches, so these add up to more than the ${compliance.matches.total} above.`}
          >
            <BarChart
              data={alerts.map((a) => ({ label: TOPIC_LABELS[a.topic], value: a.count }))}
            />
          </Panel>
        )}

        {deadlines.length > 0 && (
          <Panel title="Upcoming compliance deadlines">
            <ul className="space-y-2.5">
              {deadlines.map((deadline) => {
                const meta = COMPLIANCE_STATUS_LABELS[deadline.status]
                return (
                  <li key={`${deadline.employeeRef}-${deadline.label}`}>
                    <Link
                      href={`/assignments/${deadline.employeeRef}`}
                      className="block group"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-mono text-[11px] font-medium text-accent">
                          {deadline.employeeRef}
                        </span>
                        <span className={`shrink-0 text-[10px] font-medium ${meta.className}`}>
                          {meta.label}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[12px] leading-snug text-foreground/85 group-hover:text-accent">
                        {deadline.label}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted">
                        Due {formatDate(deadline.dueDate)} · {relativeToNow(deadline.dueDate)}
                      </p>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </Panel>
        )}

        {/* --- learning ----------------------------------------------- */}
        <Panel
          title="Your learning"
          action={
            <Link href="/learn" className="text-[11px] font-medium text-accent hover:underline">
              Lessons
            </Link>
          }
        >
          <div className="mb-4 grid grid-cols-3 gap-2">
            <StatTile
              label="Question accuracy"
              /* Null, not 0%. "You got everything wrong" and "you have not
                 started" are opposite things and must not render the same. */
              value={accuracy === null ? '—' : `${Math.round(accuracy * 100)}%`}
              note={
                accuracy === null
                  ? 'No questions answered yet'
                  : `${learning.questions.correct} of ${learning.questions.answered}`
              }
              tone={accuracy !== null && accuracy >= 0.7 ? 'good' : 'default'}
            />
            <StatTile label="Terms known" value={learning.vocabulary.known} tone="good" />
            <StatTile
              label="Terms to review"
              value={learning.vocabulary.needsReview}
              tone={learning.vocabulary.needsReview > 0 ? 'warning' : 'default'}
            />
          </div>

          <div className="space-y-3">
            <Meter
              label="Lesson questions attempted"
              value={learning.questions.answered}
              total={learning.questions.total}
            />
            <Meter
              label="Vocabulary known"
              value={learning.vocabulary.known}
              total={learning.vocabulary.total}
              tone="good"
            />
          </div>

          {weakTopics.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
                Topics you have missed questions on
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {weakTopics.map((topic) => (
                  <li
                    key={topic.topic}
                    className="rounded-md bg-amber-500/12 px-2 py-1 text-[11px] font-medium text-amber-800 dark:text-amber-200"
                  >
                    {TOPIC_LABELS[topic.topic]} · {topic.wrong} wrong
                  </li>
                ))}
              </ul>
            </div>
          )}

          {learning.vocabulary.needsReview > 0 && (
            <Link
              href="/vocabulary/review"
              className="mt-4 block rounded-lg bg-accent px-4 py-2.5 text-center text-[13px] font-medium text-white"
            >
              Review {learning.vocabulary.needsReview}{' '}
              {learning.vocabulary.needsReview === 1 ? 'term' : 'terms'}
            </Link>
          )}
        </Panel>

        {/* The evaluation page has no tab of its own — it is for an
            interviewer and for tuning, not for daily use. */}
        <Link
          href="/evaluation"
          className="block rounded-xl border border-line bg-surface-raised px-4 py-3 text-center"
        >
          <span className="block text-[13px] font-medium text-accent">
            How well is this working? →
          </span>
          <span className="mt-0.5 block text-[11px] text-muted">
            Source backing, declined guesses, question validity, collection health
          </span>
        </Link>

        <p className="px-1 pt-1 text-[11px] leading-relaxed text-muted">
          Every figure on this page is a count or a date comparison computed from stored records.
          Nothing here is estimated or generated.
        </p>
      </div>
    </main>
  )
}
