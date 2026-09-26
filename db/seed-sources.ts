/**
 * Seed: jurisdictions and the controlled source list
 * ==================================================
 *
 * These are configuration, not content — they live in the database so that
 * "new jurisdictions and sources can be added later without redesigning the
 * product". Adding Germany later is an INSERT here, not a code change.
 *
 * Every source below was chosen for FEED RELIABILITY over how interesting the
 * jurisdiction is. A tax authority with fascinating rules and an unscrapeable
 * website makes for a broken demo; one with a boring RSS feed makes for a
 * working product. Feed URLs are verified live in phase 6 — until then the
 * app runs on seed developments and never touches the network.
 *
 * Run with:  npm run db:seed:sources
 */

import { db } from './index'
import { jurisdictions, sources } from './schema'

type JurisdictionSeed = typeof jurisdictions.$inferInsert
type SourceSeed = typeof sources.$inferInsert

/* --------------------------------------------------------------------------
 * Jurisdictions
 *
 * US federal plus two states, because the brief calls out "domestic
 * state-to-state travel" as a first-class concern, not a footnote. New York and
 * California are the two highest-volume US mobility corridors and both publish
 * usable guidance.
 * -------------------------------------------------------------------------- */

const JURISDICTIONS: JurisdictionSeed[] = [
  { code: 'US', name: 'United States (federal)', kind: 'country' },
  { code: 'US-NY', name: 'New York', kind: 'us_state', parentCode: 'US' },
  { code: 'US-CA', name: 'California', kind: 'us_state', parentCode: 'US' },
  { code: 'GB', name: 'United Kingdom', kind: 'country' },
  { code: 'IE', name: 'Ireland', kind: 'country' },
  { code: 'CA', name: 'Canada', kind: 'country' },
  // Not polled for developments in v1, but needed as a target for treaty and
  // totalization-agreement references that point somewhere non-national.
  { code: 'OECD', name: 'OECD', kind: 'supranational', enabled: false },
]

/* --------------------------------------------------------------------------
 * Sources, in the brief's priority order
 * -------------------------------------------------------------------------- */

/*
 * ALL URLS BELOW WERE VERIFIED LIVE on 2026-09-26 with `npm run probe:feeds`.
 * Re-run that script if a source starts failing — it reports status, whether
 * conditional requests are supported, and how many items each shape yields.
 *
 * The first pass of this file guessed these URLs and most were wrong: the IRS
 * has no RSS feed at all (every candidate 404'd), Irish Revenue's advertised
 * XML path serves HTML, and the CRA's own department filter returns zero
 * entries. Guessing feed URLs from how a site "should" be organised does not
 * work; probing does.
 */
const SOURCES: SourceSeed[] = [
  /* --- Tier 1: primary official ---------------------------------------- */
  {
    name: 'IRS newsroom',
    publisher: 'Internal Revenue Service',
    jurisdictionCode: 'US',
    tier: 'primary_official',
    // VERIFIED: the IRS publishes no RSS or Atom feed. Every candidate
    // (/newsroom/rss, /uac/rss-news-releases, /about-irs/rss-feeds) returns
    // 404. The current-month news-release index is the only machine-readable
    // entry point, and it does at least support ETag and Last-Modified, so
    // conditional requests still work.
    feedKind: 'html_scrape',
    feedUrl: 'https://www.irs.gov/newsroom/news-releases-for-current-month',
    articleLinkPattern: '/newsroom/',
    homepageUrl: 'https://www.irs.gov/newsroom',
    notes:
      'No RSS exists — HTML index, but with working ETag/Last-Modified. High volume and mostly ' +
      'domestic, so the relevance screen does the heavy lifting. Watch for withholding, ' +
      'residency and treaty items.',
  },
  {
    name: 'GOV.UK — HMRC publications',
    publisher: 'HM Revenue & Customs',
    jurisdictionCode: 'GB',
    tier: 'primary_official',
    // VERIFIED: the Atom feed returns 20 entries with an ETag. Chosen over the
    // JSON content API, which also works but nests documents several levels
    // deep in a 117KB payload whose shape is undocumented — the Atom feed is a
    // stable contract for the same content, and article bodies are fetched from
    // the JSON API per-item anyway (see fetchArticle).
    feedKind: 'atom',
    feedUrl: 'https://www.gov.uk/government/organisations/hm-revenue-customs.atom',
    homepageUrl: 'https://www.gov.uk/government/organisations/hm-revenue-customs',
    notes:
      'The best-behaved source in the set: real feed, honest timestamps, proper conditional ' +
      'requests, and per-article JSON via /api/content. The reason the UK is in v1.',
  },
  {
    name: 'Irish Revenue — eBriefs',
    publisher: 'Revenue Commissioners (Ireland)',
    jurisdictionCode: 'IE',
    tier: 'primary_official',
    // VERIFIED: /en/corporate/rss/ebrief.xml returns HTML, not XML — the
    // advertised RSS path does not serve a feed. The eBrief index page does
    // work (187 links), so it is scraped. Note it sends no ETag or
    // Last-Modified, so this source cannot benefit from conditional requests
    // and is re-parsed every run. Cheap, because parsing is free and only new
    // URLs proceed.
    feedKind: 'html_scrape',
    feedUrl: 'https://www.revenue.ie/en/tax-professionals/ebrief/index.aspx',
    articleLinkPattern: '/ebrief/',
    homepageUrl: 'https://www.revenue.ie/en/tax-professionals/ebrief/index.aspx',
    notes:
      'Low volume, high signal — eBriefs are practitioner-targeted and frequently cover PAYE, ' +
      'cross-border workers, and SARP. No conditional-request support.',
  },
  {
    name: 'Government of Canada — news releases',
    publisher: 'Government of Canada',
    jurisdictionCode: 'CA',
    tier: 'primary_official',
    // VERIFIED: filtering by dept=canadarevenueagency returns ZERO entries —
    // the department key is wrong or CRA does not publish under it. The
    // unfiltered news-release feed returns 20 entries with an ETag, so we take
    // all departments and let the relevance screen reject the rest.
    //
    // That trade is deliberate: a broader feed costs a few more Haiku calls
    // (~$0.0025 each) and catches CRA items reliably, whereas a filter that
    // silently returns nothing looks like "no news" forever. Failing loud beats
    // failing empty.
    feedKind: 'atom',
    feedUrl:
      'https://api.io.canada.ca/io-server/gc/news/en/v2?type=newsreleases&sort=publishedDate&orderBy=desc&pick=20&format=atom',
    homepageUrl: 'https://www.canada.ca/en/revenue-agency/news.html',
    notes:
      'All-department feed, not CRA-only: the department filter returns zero results. Noisier ' +
      'but reliable. Useful for US-Canada commuter and Regulation 102 waiver items.',
  },
  {
    name: 'New York State Department of Taxation and Finance',
    publisher: 'NYS Department of Taxation and Finance',
    jurisdictionCode: 'US-NY',
    tier: 'primary_official',
    // VERIFIED: 200, 90 links, no conditional-request support.
    feedKind: 'html_scrape',
    feedUrl: 'https://www.tax.ny.gov/press/',
    articleLinkPattern: '/press/',
    homepageUrl: 'https://www.tax.ny.gov/',
    notes:
      'No RSS — HTML adapter, expect occasional breakage after a redesign. Included because NY ' +
      'convenience-of-the-employer rules are central to US state-to-state mobility.',
  },
  {
    name: 'California Franchise Tax Board — newsroom',
    publisher: 'California Franchise Tax Board',
    jurisdictionCode: 'US-CA',
    tier: 'primary_official',
    feedKind: 'html_scrape',
    feedUrl: 'https://www.ftb.ca.gov/about-ftb/newsroom/index.html',
    articleLinkPattern: '/newsroom/',
    homepageUrl: 'https://www.ftb.ca.gov/',
    // DISABLED, and not for a technical reason.
    //
    // Every FTB URL returns 403 Forbidden to an identified, single-request,
    // conditional GET. That is a deliberate access restriction, and the brief
    // is explicit: "Respect access restrictions and avoid depending on
    // paywalled or blocked sources for the core experience."
    //
    // Working around it would mean disguising the client, which is not a
    // technical problem to solve but a decision not to make. The row stays so
    // the situation is documented and so California can be re-enabled if FTB
    // publishes a feed; the app simply does not claim California coverage.
    enabled: false,
    accessUnrestricted: false,
    notes:
      'DISABLED — returns 403 to all requests. Deliberately not worked around: the brief says to ' +
      'respect access restrictions. California developments therefore come only from the seeded ' +
      'demonstration item until FTB offers a feed. Re-probe with npm run probe:feeds.',
  },

  /* --- Tier 2: professional / technical --------------------------------- */
  {
    name: 'OECD Tax — news',
    publisher: 'OECD',
    jurisdictionCode: null,
    tier: 'professional',
    feedKind: 'rss',
    feedUrl: 'https://www.oecd.org/en/topics/taxation.xml',
    homepageUrl: 'https://www.oecd.org/en/topics/policy-issues/taxation.html',
    enabled: false,
    notes:
      'Disabled in v1. Treaty and cross-border policy context, but rarely a development a GMS team ' +
      'must act on. Enable once the five core jurisdictions are stable.',
  },

  /* --- Tier 3: press ----------------------------------------------------
   * Deliberately empty in v1.
   *
   * The brief allows press for discovery, but "it should not normally be the
   * sole basis for presenting a rule as confirmed" — and the verification
   * ceiling in db/invariants.ts already caps a press-only development at
   * 'single_source'. Adding press feeds before that pipeline is proven would
   * mostly generate items that can never be published. Revisit in phase 6.
   * -------------------------------------------------------------------- */
]

/* -------------------------------------------------------------------------- */

async function main() {
  console.log('Seeding jurisdictions and sources...\n')

  // onConflictDoNothing makes this idempotent — safe to re-run after adding a
  // source, without duplicating or clobbering live polling state (etag,
  // lastFetchedAt) on rows that already exist.
  const insertedJurisdictions = await db
    .insert(jurisdictions)
    .values(JURISDICTIONS)
    .onConflictDoNothing()
    .returning({ code: jurisdictions.code })

  console.log(`  jurisdictions: ${insertedJurisdictions.length} inserted, ${JURISDICTIONS.length - insertedJurisdictions.length} already present`)

  const insertedSources = await db
    .insert(sources)
    .values(SOURCES)
    .onConflictDoNothing()
    .returning({ name: sources.name })

  console.log(`  sources:       ${insertedSources.length} inserted, ${SOURCES.length - insertedSources.length} already present`)

  /* --- read back, as a genuine end-to-end check ------------------------- */
  const allSources = await db.select().from(sources)
  const enabled = allSources.filter((s) => s.enabled)

  console.log(`\n${allSources.length} sources on file, ${enabled.length} enabled for polling:\n`)
  for (const s of enabled) {
    console.log(`  [${s.tier.padEnd(16)}] ${(s.jurisdictionCode ?? '--').padEnd(6)} ${s.name}`)
  }

  const byKind = enabled.reduce<Record<string, number>>((acc, s) => {
    acc[s.feedKind] = (acc[s.feedKind] ?? 0) + 1
    return acc
  }, {})
  console.log(`\n  feed types: ${Object.entries(byKind).map(([k, n]) => `${k}=${n}`).join(', ')}`)
  console.log('\nDone.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
