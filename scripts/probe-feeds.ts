/**
 * Probe candidate feed URLs and report what they actually serve
 * =============================================================
 *
 * The seeded feed URLs were educated guesses, flagged as such in
 * db/seed-sources.ts. This resolves them against reality: status, content type,
 * whether conditional requests are supported, and how many items each shape
 * yields. Costs nothing and touches no AI.
 *
 * Run with:  npm run probe:feeds
 */

const USER_AGENT =
  'GMS-Tax-Intelligence/0.1 (educational project; respects robots and conditional requests)'

const CANDIDATES: { name: string; url: string; kind: string }[] = [
  // --- US federal ---
  { name: 'IRS newsroom (current guess)', url: 'https://www.irs.gov/newsroom/rss', kind: 'rss' },
  { name: 'IRS newsroom alt 1', url: 'https://www.irs.gov/about-irs/rss-feeds', kind: 'html' },
  { name: 'IRS newsroom alt 2', url: 'https://www.irs.gov/newsroom/news-releases-for-current-month', kind: 'html' },
  { name: 'IRS IR feed', url: 'https://www.irs.gov/uac/rss-news-releases', kind: 'rss' },

  // --- UK ---
  {
    name: 'GOV.UK HMRC org (current guess)',
    url: 'https://www.gov.uk/api/content/government/organisations/hm-revenue-customs',
    kind: 'govuk',
  },
  {
    name: 'GOV.UK search API, HMRC docs',
    url: 'https://www.gov.uk/api/search.json?filter_organisations=hm-revenue-customs&order=-public_timestamp&count=20&fields=title,link,public_timestamp,description',
    kind: 'govuk-search',
  },
  {
    name: 'GOV.UK HMRC atom',
    url: 'https://www.gov.uk/government/organisations/hm-revenue-customs.atom',
    kind: 'atom',
  },

  // --- Ireland ---
  { name: 'Irish Revenue eBrief (current guess)', url: 'https://www.revenue.ie/en/corporate/rss/ebrief.xml', kind: 'rss' },
  { name: 'Irish Revenue eBrief alt', url: 'https://www.revenue.ie/en/tax-professionals/ebrief/index.aspx', kind: 'html' },
  { name: 'Irish Revenue press rss', url: 'https://www.revenue.ie/en/corporate/rss/press-releases.xml', kind: 'rss' },

  // --- Canada ---
  {
    name: 'CRA news (current guess)',
    url: 'https://api.io.canada.ca/io-server/gc/news/en/v2?dept=canadarevenueagency&format=atom',
    kind: 'atom',
  },
  {
    name: 'CRA news json',
    url: 'https://api.io.canada.ca/io-server/gc/news/en/v2?dept=canadarevenueagency&type=newsreleases&sort=publishedDate&orderBy=desc&publishedDate%3E=2026-01-01&pick=50&format=json',
    kind: 'json',
  },

  // --- US states ---
  { name: 'NY tax press (current guess)', url: 'https://www.tax.ny.gov/press/', kind: 'html' },
  { name: 'NY tax news', url: 'https://www.tax.ny.gov/press/news.htm', kind: 'html' },
  { name: 'CA FTB newsroom (current guess)', url: 'https://www.ftb.ca.gov/about-ftb/newsroom/index.html', kind: 'html' },
  { name: 'CA FTB tax news', url: 'https://www.ftb.ca.gov/about-ftb/newsroom/tax-news/index.html', kind: 'html' },

  // --- Canada, second round (both first attempts returned zero items) ---
  { name: 'Canada.ca CRA news page', url: 'https://www.canada.ca/en/revenue-agency/news.html', kind: 'html' },
  {
    name: 'Canada.ca news API, no date filter',
    url: 'https://api.io.canada.ca/io-server/gc/news/en/v2?dept=canadarevenueagency&sort=publishedDate&orderBy=desc&pick=20&format=atom',
    kind: 'atom',
  },
  {
    name: 'Canada.ca all-dept news atom',
    url: 'https://api.io.canada.ca/io-server/gc/news/en/v2?type=newsreleases&sort=publishedDate&orderBy=desc&pick=20&format=atom',
    kind: 'atom',
  },
]

async function probe(candidate: { name: string; url: string; kind: string }) {
  let response: Response
  try {
    response = await fetch(candidate.url, {
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      signal: AbortSignal.timeout(20_000),
      redirect: 'follow',
    })
  } catch (error) {
    return { ...candidate, status: 'ERR', detail: error instanceof Error ? error.message : String(error) }
  }

  const contentType = response.headers.get('content-type')?.split(';')[0] ?? '?'
  const etag = response.headers.get('etag') ? 'etag' : ''
  const lastMod = response.headers.get('last-modified') ? 'last-mod' : ''
  const validators = [etag, lastMod].filter(Boolean).join('+') || 'none'

  if (!response.ok) {
    return { ...candidate, status: String(response.status), detail: `${contentType}` }
  }

  const body = await response.text()

  // Cheap shape detection — enough to tell whether an adapter would find items.
  let shape = ''
  if (body.includes('<rss')) shape = `rss items=${count(body, '<item')}`
  else if (body.includes('<feed')) shape = `atom entries=${count(body, '<entry')}`
  else if (contentType.includes('json')) {
    try {
      const json = JSON.parse(body) as Record<string, unknown>
      const keys = Object.keys(json).slice(0, 6).join(',')
      const docs = (json.links as { documents?: unknown[] } | undefined)?.documents?.length
      const results = (json.results as unknown[] | undefined)?.length
      shape = `json keys=[${keys}]${docs !== undefined ? ` documents=${docs}` : ''}${results !== undefined ? ` results=${results}` : ''}`
    } catch {
      shape = 'json (unparseable)'
    }
  } else {
    shape = `html links=${count(body, '<a ')}`
  }

  return {
    ...candidate,
    status: String(response.status),
    detail: `${validators} · ${shape} · ${Math.round(body.length / 1024)}KB`,
  }
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

async function main() {
  console.log('Probing candidate feed URLs...\n')
  for (const candidate of CANDIDATES) {
    const result = await probe(candidate)
    const flag = result.status === '200' ? ' ' : '!'
    console.log(`${flag} [${result.status.padStart(3)}] ${result.name}`)
    console.log(`        ${result.detail}`)
  }
  console.log('\nDone.')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
