/**
 * Chart components
 * ================
 *
 * Plain HTML and CSS. No charting library: these are bar lengths and a stacked
 * ratio, which `width: %` expresses exactly, and a library would add ~100KB to
 * a phone-first app to draw rectangles.
 *
 * COLOR DECISIONS, AND WHY
 *
 * Every palette here was run through the data-viz validator rather than chosen
 * by eye, and one of them failed and had to change:
 *
 *   The development lifecycle (discussion → proposed → enacted → official
 *   guidance → effective) is rendered as a SINGLE-HUE ORDINAL RAMP, not as the
 *   five distinct colors the status badges use elsewhere in the app.
 *
 *   Those badge colors are right for badges — each sits beside its own text
 *   label. As chart segments they failed outright: blue (enacted) against
 *   violet (official guidance) measured ΔE 0.4 under deuteranopia, meaning a
 *   red-green colorblind reader cannot separate them at all, and slate read as
 *   pure gray.
 *
 *   The ordinal ramp is also the better form on the merits. Lifecycle status is
 *   ORDERED — it runs from "someone mentioned it" to "this is law today" — and a
 *   light→dark ramp encodes that ordering. Categorical colors actively hide it.
 *   Validated: monotone lightness, all adjacent ΔL ≥ 0.06, light end clears
 *   2:1 against the surface, hue spread 3°. Passes in both modes.
 *
 * Magnitude comparisons (developments per jurisdiction, per topic, alerts) use
 * ONE hue with no per-bar variation. They are a single series, so per the mark
 * rules they get no legend — the chart title says what is plotted — and the
 * value rides the bar end rather than needing an axis.
 */

/* ==========================================================================
 * Tokens
 * ========================================================================== */

/**
 * The validated ordinal ramp, light→dark for light mode and reversed for dark.
 *
 * Steps 250 / 350 / 450 / 550 / 650 of the blue ramp. The lightest step is
 * deliberately not lighter than 250: below that it recedes into the surface,
 * which is acceptable for a continuous heatmap but not for a discrete segment
 * that has to be seen.
 */
const LIFECYCLE_RAMP = [
  { light: '#86b6ef', dark: '#184f95' },
  { light: '#5598e7', dark: '#256abf' },
  { light: '#2a78d6', dark: '#3987e5' },
  { light: '#1c5cab', dark: '#6da7ec' },
  { light: '#104281', dark: '#9ec5f4' },
] as const

/* ==========================================================================
 * Stat tile
 * ========================================================================== */

/**
 * Stat tile: label, value, optional note.
 *
 * `value` may be a string so callers can pass "—" for genuinely absent data.
 * That matters here: an accuracy figure of 0% and an accuracy figure that does
 * not exist yet look identical if both render as a number, and they mean
 * opposite things.
 */
export function StatTile({
  label,
  value,
  note,
  tone = 'default',
}: {
  label: string
  value: string | number
  note?: string
  tone?: 'default' | 'warning' | 'good'
}) {
  const valueTone =
    tone === 'warning'
      ? 'text-amber-700 dark:text-amber-300'
      : tone === 'good'
        ? 'text-emerald-700 dark:text-emerald-300'
        : 'text-foreground'

  return (
    <div className="rounded-xl border border-line bg-surface-raised px-3 py-3">
      {/* Proportional figures, not tabular: at this size tabular-nums gives
          every digit the width of a 0 and a number like 121 looks loose. */}
      <p className={`text-[22px] leading-none font-semibold ${valueTone}`}>{value}</p>
      <p className="mt-1.5 text-[11px] leading-tight text-muted">{label}</p>
      {note && <p className="mt-1 text-[10px] leading-tight text-muted/80">{note}</p>}
    </div>
  )
}

/** The one number the dashboard leads with. Exactly one per view. */
export function HeroFigure({
  value,
  label,
  note,
}: {
  value: string | number
  label: string
  note?: string
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-raised px-4 py-5 text-center">
      <p className="text-[52px] leading-none font-semibold tracking-tight text-foreground">
        {value}
      </p>
      <p className="mt-2 text-[13px] font-medium text-foreground/80">{label}</p>
      {note && <p className="mx-auto mt-1 max-w-[28ch] text-[11px] leading-relaxed text-muted">{note}</p>}
    </div>
  )
}

/* ==========================================================================
 * Horizontal bar chart — magnitude, single series
 * ========================================================================== */

export type BarDatum = { label: string; value: number; href?: string }

/**
 * Magnitude comparison. One hue, no legend (single series), value at the bar
 * end.
 *
 * Horizontal rather than vertical because the category labels are words
 * ("Tax residency", "New York") — rotated or truncated x-axis labels are the
 * most common way a small chart becomes unreadable on a phone.
 *
 * Bars are capped at 24px and the track keeps its leftover as air, per the mark
 * spec. No gridlines: with the value printed at each bar end there is nothing
 * for a gridline to tell you.
 */
export function BarChart({
  data,
  caption,
  emptyLabel = 'Nothing to show yet',
}: {
  data: BarDatum[]
  caption?: string
  emptyLabel?: string
}) {
  if (data.length === 0) {
    return <p className="px-1 py-2 text-[12px] text-muted">{emptyLabel}</p>
  }

  const max = Math.max(...data.map((d) => d.value), 1)

  return (
    <figure className="m-0">
      <ul className="space-y-2">
        {data.map((datum) => {
          const pct = Math.max((datum.value / max) * 100, 2)
          return (
            <li key={datum.label} className="grid grid-cols-[minmax(0,9.5rem)_1fr] items-center gap-2">
              {/* Label in a text token, never the series color — a mid-blue is
                  illegible as small text on either surface. */}
              <span className="truncate text-[12px] text-foreground/80" title={datum.label}>
                {datum.label}
              </span>
              <span className="flex items-center gap-2">
                <span
                  className="h-[14px] rounded-r-[4px] bg-[#2a78d6] dark:bg-[#3987e5]"
                  style={{ width: `${pct}%` }}
                  aria-hidden
                />
                <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted">
                  {datum.value}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
      {caption && <figcaption className="mt-2 text-[11px] leading-relaxed text-muted">{caption}</figcaption>}
    </figure>
  )
}

/* ==========================================================================
 * Lifecycle bar — part-to-whole on an ordered scale
 * ========================================================================== */

export type LifecycleDatum = { label: string; value: number }

/**
 * A single stacked bar showing how the feed splits across the lifecycle, plus a
 * legend.
 *
 * The legend is mandatory (more than two series) and every segment is also
 * named in it with its count, so identity never rests on color alone — which is
 * what makes the ordinal ramp safe even where two steps sit close together.
 *
 * Segments are separated by a 2px gap in the surface color, not by a stroke: a
 * border adds ink that isn't data.
 */
export function LifecycleBar({
  data,
  unknown = 0,
}: {
  data: LifecycleDatum[]
  unknown?: number
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0) + unknown
  if (total === 0) {
    return <p className="px-1 py-2 text-[12px] text-muted">No developments yet</p>
  }

  const segments = [
    ...data.map((datum, index) => ({
      ...datum,
      light: LIFECYCLE_RAMP[index].light,
      dark: LIFECYCLE_RAMP[index].dark,
      isUnknown: false,
    })),
    // "Status not stated" is not a lifecycle step, so it must not take a ramp
    // colour — that would place it on the scale as though it were a stage. It
    // gets a hatched neutral instead, matching how the badge renders it.
    ...(unknown > 0
      ? [{ label: 'Status not stated', value: unknown, light: '', dark: '', isUnknown: true }]
      : []),
  ].filter((s) => s.value > 0)

  return (
    <figure className="m-0">
      <div className="flex h-5 w-full gap-[2px] overflow-hidden rounded-[4px]">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className={
              segment.isUnknown
                ? 'h-full bg-[repeating-linear-gradient(135deg,var(--border)_0_4px,transparent_4px_8px)] ring-1 ring-inset ring-line'
                : 'h-full'
            }
            style={{
              width: `${(segment.value / total) * 100}%`,
              ...(segment.isUnknown
                ? {}
                : { backgroundColor: `light-dark(${segment.light}, ${segment.dark})` }),
            }}
            aria-hidden
          />
        ))}
      </div>

      <ul className="mt-3 grid grid-cols-1 gap-1.5">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center gap-2 text-[12px]">
            <span
              className={
                segment.isUnknown
                  ? 'size-2.5 shrink-0 rounded-[2px] bg-[repeating-linear-gradient(135deg,var(--border)_0_3px,transparent_3px_6px)] ring-1 ring-inset ring-line'
                  : 'size-2.5 shrink-0 rounded-[2px]'
              }
              style={
                segment.isUnknown
                  ? {}
                  : { backgroundColor: `light-dark(${segment.light}, ${segment.dark})` }
              }
              aria-hidden
            />
            <span className="flex-1 text-foreground/80">{segment.label}</span>
            <span className="tabular-nums font-medium text-muted">{segment.value}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

/* ==========================================================================
 * Meter — one ratio against a total
 * ========================================================================== */

/**
 * A meter, not a two-slice pie.
 *
 * The unfilled track is a lighter step of the SAME hue as the fill, so the
 * state reads across the whole bar rather than the track looking like empty
 * space.
 */
export function Meter({
  label,
  value,
  total,
  /** Shown instead of "x of y" when a raw ratio would mislead. */
  valueLabel,
  tone = 'accent',
}: {
  label: string
  value: number
  total: number
  valueLabel?: string
  tone?: 'accent' | 'warning' | 'good'
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0

  const fill =
    tone === 'warning'
      ? 'bg-[#fab219]'
      : tone === 'good'
        ? 'bg-[#0ca30c]'
        : 'bg-[#2a78d6] dark:bg-[#3987e5]'

  const track =
    tone === 'warning'
      ? 'bg-[#fab219]/20'
      : tone === 'good'
        ? 'bg-[#0ca30c]/20'
        : 'bg-[#2a78d6]/18 dark:bg-[#3987e5]/22'

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-foreground/80">{label}</span>
        <span className="text-[11px] font-medium tabular-nums text-muted">
          {valueLabel ?? `${value} of ${total}`}
        </span>
      </div>
      <div className={`h-2 w-full overflow-hidden rounded-full ${track}`}>
        <div
          className={`h-full rounded-full ${fill}`}
          style={{ width: `${Math.max(pct, value > 0 ? 3 : 0)}%` }}
          role="meter"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={label}
        />
      </div>
    </div>
  )
}

/* ==========================================================================
 * Panel
 * ========================================================================== */

export function Panel({
  title,
  note,
  children,
  action,
}: {
  title: string
  note?: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-line bg-surface-raised p-4">
      <header className="mb-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
          {action}
        </div>
        {note && <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{note}</p>}
      </header>
      {children}
    </section>
  )
}
