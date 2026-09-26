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

const SOURCES: SourceSeed[] = [
  /* --- Tier 1: primary official ---------------------------------------- */
  {
    name: 'IRS Newsroom',
    publisher: 'Internal Revenue Service',
    jurisdictionCode: 'US',
    tier: 'primary_official',
    feedKind: 'rss',
    feedUrl: 'https://www.irs.gov/newsroom/rss',
    homepageUrl: 'https://www.irs.gov/newsroom',
    notes:
      'US federal announcements, revenue procedures, and notices. High volume; most items are ' +
      'domestic and screened out. Watch for withholding, residency, and treaty items.',
  },
  {
    name: 'GOV.UK — HMRC publications',
    publisher: 'HM Revenue & Customs',
    jurisdictionCode: 'GB',
    tier: 'primary_official',
    // GOV.UK exposes a genuine JSON content API with no key and no rate limit
    // worth worrying about. It is the single best mobility-tax source available
    // and the reason the UK is in v1.
    feedKind: 'govuk_content_api',
    feedUrl: 'https://www.gov.uk/api/content/government/organisations/hm-revenue-customs',
    homepageUrl: 'https://www.gov.uk/government/organisations/hm-revenue-customs',
    notes:
      'Structured JSON, stable schema, includes publication and updated timestamps plus the full ' +
      'body text. Supports conditional GET properly.',
  },
  {
    name: 'Irish Revenue — eBriefs',
    publisher: 'Revenue Commissioners (Ireland)',
    jurisdictionCode: 'IE',
    tier: 'primary_official',
    feedKind: 'rss',
    feedUrl: 'https://www.revenue.ie/en/corporate/rss/ebrief.xml',
    homepageUrl: 'https://www.revenue.ie/en/tax-professionals/ebrief/index.aspx',
    notes:
      'Low volume, high signal — eBriefs are practitioner-targeted and frequently cover PAYE, ' +
      'cross-border workers, and special assignee relief (SARP).',
  },
  {
    name: 'Canada Revenue Agency — newsroom',
    publisher: 'Canada Revenue Agency',
    jurisdictionCode: 'CA',
    tier: 'primary_official',
    feedKind: 'rss',
    feedUrl: 'https://api.io.canada.ca/io-server/gc/news/en/v2?dept=canadarevenueagency&format=atom',
    homepageUrl: 'https://www.canada.ca/en/revenue-agency/news.html',
    notes:
      'Government of Canada news API, Atom format. Filter by department. Useful for US-Canada ' +
      'cross-border commuter and waiver items.',
  },
  {
    name: 'New York State Department of Taxation and Finance',
    publisher: 'NYS Department of Taxation and Finance',
    jurisdictionCode: 'US-NY',
    tier: 'primary_official',
    feedKind: 'html_scrape',
    feedUrl: 'https://www.tax.ny.gov/press/',
    homepageUrl: 'https://www.tax.ny.gov/',
    notes:
      'No RSS — needs an HTML adapter, so expect this one to break occasionally. Included because ' +
      'NY convenience-of-the-employer rules are central to US state-to-state mobility.',
  },
  {
    name: 'California Franchise Tax Board — newsroom',
    publisher: 'California Franchise Tax Board',
    jurisdictionCode: 'US-CA',
    tier: 'primary_official',
    feedKind: 'html_scrape',
    feedUrl: 'https://www.ftb.ca.gov/about-ftb/newsroom/index.html',
    homepageUrl: 'https://www.ftb.ca.gov/',
    notes:
      'No RSS — HTML adapter. Relevant for residency (FTB 1031-style guidance) and nonresident ' +
      'withholding.',
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
