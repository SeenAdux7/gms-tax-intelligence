/**
 * Source adapters — fetching and parsing feeds
 * ============================================
 *
 * One adapter per feed shape. The shape is a column on the source row
 * (`feed_kind`), so adding a jurisdiction is a database insert plus, at worst,
 * one new adapter here — never a change to the pipeline.
 *
 * CONDITIONAL GET IS THE WHOLE COST MODEL
 *
 * Every fetch sends back the `ETag` / `Last-Modified` the server gave us last
 * time. An unchanged feed answers `304 Not Modified` with no body, which costs
 * one tiny HTTP round trip and zero AI calls. That is what makes checking
 * hourly cost the same as checking daily: the bill tracks how many NEW articles
 * appear, not how often we look.
 *
 * Every adapter is failure-isolated. A government site that changes its HTML,
 * rate-limits us, or simply goes down degrades THAT source and nothing else —
 * the run continues, the failure is recorded against the source row, and
 * `consecutive_failures` climbs so a permanently broken scraper is visible
 * rather than silently returning nothing forever.
 */

import { XMLParser } from 'fast-xml-parser'
import * as cheerio from 'cheerio'

export type FeedKind = 'rss' | 'atom' | 'govuk_content_api' | 'json' | 'html_scrape'

/** One item discovered in a feed. Not yet an article — just enough to fetch it. */
export type FeedItem = {
  url: string
  title: string | null
  /** As stated by the feed. Null when the feed carries no date — we never
   *  substitute "now", which would invent a publication date. */
  publishedAt: Date | null
  /** Summary or content included in the feed itself, when present. Saves a
   *  second request for feeds that inline the full text. */
  inlineText: string | null
}

export type FetchResult =
  | { kind: 'not_modified' }
  | { kind: 'ok'; items: FeedItem[]; etag: string | null; lastModified: string | null }
  | { kind: 'error'; status: number | null; message: string }

const USER_AGENT =
  'GMS-Tax-Intelligence/0.1 (educational project; respects robots and conditional requests)'

/** Feeds can be slow; government sites especially. Bound it so one hanging
 *  request cannot stall an hourly run. */
const TIMEOUT_MS = 20_000

/* ==========================================================================
 * The fetch
 * ========================================================================== */

export async function fetchFeed(source: {
  feedUrl: string
  feedKind: FeedKind
  lastEtag: string | null
  lastModified: string | null
  /** For html_scrape sources: path regex identifying an article link. */
  articleLinkPattern?: string | null
}): Promise<FetchResult> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: acceptFor(source.feedKind),
  }

  // The two headers that make hourly polling free.
  if (source.lastEtag) headers['If-None-Match'] = source.lastEtag
  if (source.lastModified) headers['If-Modified-Since'] = source.lastModified

  let response: Response
  try {
    response = await fetch(source.feedUrl, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    })
  } catch (error) {
    return {
      kind: 'error',
      status: null,
      message: error instanceof Error ? error.message : String(error),
    }
  }

  if (response.status === 304) return { kind: 'not_modified' }

  if (!response.ok) {
    return {
      kind: 'error',
      status: response.status,
      message: `HTTP ${response.status} ${response.statusText}`,
    }
  }

  const body = await response.text()
  const etag = response.headers.get('etag')
  const lastModified = response.headers.get('last-modified')

  try {
    const items = parseFeed(body, source.feedKind, source.feedUrl, source.articleLinkPattern)
    return { kind: 'ok', items, etag, lastModified }
  } catch (error) {
    // A parse failure is a source problem, not a pipeline problem. Recorded
    // against the source so a site that changed its markup shows up in the
    // dashboard rather than quietly yielding nothing.
    return {
      kind: 'error',
      status: response.status,
      message: `Parse failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function acceptFor(kind: FeedKind): string {
  switch (kind) {
    case 'rss':
    case 'atom':
      return 'application/rss+xml, application/atom+xml, application/xml, text/xml'
    case 'govuk_content_api':
    case 'json':
      return 'application/json'
    case 'html_scrape':
      return 'text/html'
  }
}

/* ==========================================================================
 * Parsers
 * ========================================================================== */

function parseFeed(
  body: string,
  kind: FeedKind,
  feedUrl: string,
  articleLinkPattern?: string | null,
): FeedItem[] {
  switch (kind) {
    case 'rss':
    case 'atom':
      return parseXmlFeed(body)
    case 'govuk_content_api':
      return parseGovUkContentApi(body)
    case 'json':
      return parseGenericJson(body)
    case 'html_scrape':
      return parseHtmlIndex(body, feedUrl, articleLinkPattern)
  }
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  trimValues: true,
})

/**
 * RSS 2.0 and Atom in one parser.
 *
 * They differ in element names but not in structure, and several tax
 * authorities serve one at a URL that implies the other — the CRA endpoint is
 * labelled Atom, the Irish one RSS. Sniffing the document rather than trusting
 * the configured kind avoids a class of "works until they change it" failure.
 */
function parseXmlFeed(body: string): FeedItem[] {
  const parsed = xml.parse(body) as Record<string, unknown>

  const rssChannel = (parsed.rss as { channel?: { item?: unknown } } | undefined)?.channel
  const atomFeed = parsed.feed as { entry?: unknown } | undefined

  const raw = toArray(rssChannel?.item ?? atomFeed?.entry)

  return raw
    .map((entry) => {
      const item = entry as Record<string, unknown>

      // Atom links are attribute-bearing elements, possibly several; RSS has a
      // plain text <link>.
      const url = firstString(item.link) ?? atomLinkHref(item.link) ?? firstString(item.id)
      if (!url) return null

      const published =
        firstString(item.pubDate) ??
        firstString(item.published) ??
        firstString(item.updated) ??
        firstString((item as { 'dc:date'?: unknown })['dc:date'])

      const inline =
        firstString((item as { 'content:encoded'?: unknown })['content:encoded']) ??
        firstString(item.content) ??
        firstString(item.summary) ??
        firstString(item.description)

      return {
        url: url.trim(),
        title: firstString(item.title)?.trim() ?? null,
        publishedAt: parseDate(published),
        inlineText: inline ? htmlToText(inline) : null,
      }
    })
    .filter((item): item is FeedItem => item !== null)
}

/** Atom `<link rel="alternate" href="...">`, possibly an array. */
function atomLinkHref(link: unknown): string | null {
  for (const candidate of toArray(link)) {
    const record = candidate as Record<string, unknown>
    const rel = record['@rel']
    const href = record['@href']
    if (typeof href === 'string' && (rel === undefined || rel === 'alternate')) return href
  }
  return null
}

/**
 * GOV.UK content API.
 *
 * The best-behaved source in the set: real JSON, stable schema, honest
 * timestamps, and proper conditional-request support. An organisation endpoint
 * returns its documents under `links.documents`.
 */
function parseGovUkContentApi(body: string): FeedItem[] {
  const parsed = JSON.parse(body) as {
    links?: {
      documents?: {
        base_path?: string
        title?: string
        public_updated_at?: string
        description?: string
      }[]
    }
  }

  return (parsed.links?.documents ?? [])
    .filter((doc) => doc.base_path)
    .map((doc) => ({
      url: `https://www.gov.uk${doc.base_path}`,
      title: doc.title ?? null,
      publishedAt: parseDate(doc.public_updated_at),
      inlineText: doc.description ?? null,
    }))
}

/** Loosely-shaped JSON feeds. Tries the common envelope keys. */
function parseGenericJson(body: string): FeedItem[] {
  const parsed = JSON.parse(body) as unknown
  const list = Array.isArray(parsed)
    ? parsed
    : ((parsed as Record<string, unknown>).items ??
       (parsed as Record<string, unknown>).results ??
       (parsed as Record<string, unknown>).data ??
       [])

  return toArray(list)
    .map((entry) => {
      const item = entry as Record<string, unknown>
      const url = firstString(item.url) ?? firstString(item.link) ?? firstString(item.id)
      if (!url) return null
      return {
        url,
        title: firstString(item.title) ?? firstString(item.headline) ?? null,
        publishedAt: parseDate(
          firstString(item.published) ?? firstString(item.date) ?? firstString(item.updated),
        ),
        inlineText: firstString(item.summary) ?? firstString(item.description) ?? null,
      }
    })
    .filter((item): item is FeedItem => item !== null)
}

/**
 * HTML index scraping — the fragile adapter, used where no feed exists.
 *
 * New York and California publish no RSS, and the brief's jurisdictions include
 * US state-to-state travel, so scraping is the price of covering them. This is
 * deliberately conservative: it collects candidate links that look like news or
 * press items and lets the relevance screen reject the rest. Being loose here
 * and strict later is the right way round — a scraper tuned to exact selectors
 * breaks the moment a page is redesigned, whereas over-collection just costs a
 * few Haiku calls.
 */
function parseHtmlIndex(
  body: string,
  feedUrl: string,
  articleLinkPattern?: string | null,
): FeedItem[] {
  const $ = cheerio.load(body)
  const base = new URL(feedUrl)
  const seen = new Set<string>()
  const items: FeedItem[] = []

  // The per-source pattern when configured, otherwise a generic fallback. The
  // fallback exists so a new html_scrape source works passably before anyone
  // has tuned it — not as the intended long-term arrangement.
  const pattern = articleLinkPattern
    ? new RegExp(articleLinkPattern, 'i')
    : /\/(news|press|newsroom|release|bulletin|notice|announcement|article)/i

  // Links that match the pattern but are navigation, not articles. Index pages
  // link to themselves and to their own section landing pages constantly.
  const isIndexPage = (path: string) =>
    /\/(index|home|default)(\.[a-z]+)?$/i.test(path) || path === base.pathname

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href')
    if (!href) return

    let absolute: URL
    try {
      absolute = new URL(href, base)
    } catch {
      return
    }

    if (absolute.host !== base.host) return

    const path = absolute.pathname
    if (!pattern.test(path)) return
    if (isIndexPage(path)) return

    const depth = path.replace(/\/$/, '').split('/').filter(Boolean).length
    // A path with no segment beyond the section is a landing page.
    if (depth < 2) return

    absolute.hash = ''
    absolute.search = ''
    const url = absolute.toString()
    if (seen.has(url)) return
    seen.add(url)

    const title = $(element).text().replace(/\s+/g, ' ').trim()

    /*
     * Two ways to qualify, because link text alone is not a reliable signal.
     *
     * Long link text is usually a headline, and short text is usually
     * navigation ("Press releases", "Next", "More") — but not always. Irish
     * Revenue titles its eBriefs "eBrief No. 148/26", seventeen characters,
     * and a length-only rule silently dropped every one of them while
     * reporting no error.
     *
     * So a deep URL also qualifies: four or more path segments means a
     * specific document, whatever its link text says.
     */
    const looksLikeHeadline = title.length >= 20
    const looksLikeDeepArticle = depth >= 4 && title.length >= 6
    if (!looksLikeHeadline && !looksLikeDeepArticle) return

    items.push({ url, title, publishedAt: null, inlineText: null })
  })

  // Bound it. An index page can link to hundreds of archived items, and on a
  // first run the dedupe step has seen none of them.
  return items.slice(0, 30)
}

/* ==========================================================================
 * Fetching the article itself
 * ========================================================================== */

export type ArticleResult =
  | { kind: 'ok'; text: string; title: string | null; httpStatus: number }
  | { kind: 'error'; status: number | null; message: string }

/**
 * Fetches one article and reduces it to readable text.
 *
 * GOV.UK gets its JSON API rather than its HTML, because the API returns the
 * body already structured and is far less likely to change shape.
 */
export async function fetchArticle(url: string): Promise<ArticleResult> {
  const isGovUk = url.startsWith('https://www.gov.uk/')
  const target = isGovUk ? url.replace('https://www.gov.uk/', 'https://www.gov.uk/api/content/') : url

  let response: Response
  try {
    response = await fetch(target, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: isGovUk ? 'application/json' : 'text/html',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    })
  } catch (error) {
    return { kind: 'error', status: null, message: error instanceof Error ? error.message : String(error) }
  }

  if (!response.ok) {
    return { kind: 'error', status: response.status, message: `HTTP ${response.status}` }
  }

  const body = await response.text()

  if (isGovUk) {
    try {
      const parsed = JSON.parse(body) as {
        title?: string
        details?: { body?: string; government?: unknown }
      }
      const html = parsed.details?.body ?? ''
      return {
        kind: 'ok',
        text: htmlToText(html),
        title: parsed.title ?? null,
        httpStatus: response.status,
      }
    } catch {
      // Fall through to HTML handling — the API occasionally serves a redirect
      // document for withdrawn content.
    }
  }

  const $ = cheerio.load(body)

  // Measure before stripping, so the guard below can tell "this page is empty"
  // from "our stripping emptied it".
  const textBeforeStripping = normaliseWhitespace($('body').text())

  /*
   * Strip the furniture, but NOT `form`.
   *
   * Removing `form` looks obviously right — it drops search boxes and
   * newsletter signups — and it silently destroyed an entire source. Irish
   * Revenue runs ASP.NET WebForms, which wraps the whole page in
   * `<form id="aspnetForm">`. Every eBrief extracted to exactly 0 characters
   * from 6,743 characters of real content, and the pipeline reported it as
   * "too short to use" rather than as a bug.
   *
   * Form CONTROLS are the actual noise, so those go instead. A container is
   * never the thing you want to delete.
   */
  $('script, style, noscript, iframe, svg').remove()
  $('nav, header, footer, aside').remove()
  $('input, select, textarea, button, label, [role="search"]').remove()

  const scoped =
    $('main').first().text() ||
    $('article').first().text() ||
    $('[role="main"]').first().text() ||
    $('#content, .content, #main-content').first().text() ||
    $('body').text()

  let text = normaliseWhitespace(scoped)

  /*
   * Guard: if stripping removed almost everything from a page that clearly had
   * content, the selectors are wrong for this site. Fall back to the unstripped
   * text — noisy input is recoverable, an empty extraction is not.
   */
  if (text.length < 200 && textBeforeStripping.length > 1000) {
    text = textBeforeStripping
  }

  return {
    kind: 'ok',
    text,
    title: $('h1').first().text().trim() || $('title').first().text().trim() || null,
    httpStatus: response.status,
  }
}

/* ==========================================================================
 * Helpers
 * ========================================================================== */

export function htmlToText(html: string): string {
  if (!html.includes('<')) return normaliseWhitespace(html)
  const $ = cheerio.load(html)
  $('script, style').remove()
  return normaliseWhitespace($.root().text())
}

/**
 * Collapses whitespace but keeps paragraph breaks.
 *
 * Paragraph structure matters downstream: evidence spans are character offsets
 * into this text, and a wall of single-spaced words makes a quote impossible
 * for a reader to locate in the original.
 */
export function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

/** fast-xml-parser yields strings, numbers, or `{ '#text': ... }`. */
function firstString(value: unknown): string | null {
  for (const candidate of toArray(value)) {
    if (typeof candidate === 'string') return candidate
    if (typeof candidate === 'number') return String(candidate)
    if (candidate && typeof candidate === 'object') {
      const text = (candidate as Record<string, unknown>)['#text']
      if (typeof text === 'string') return text
    }
  }
  return null
}

/** Returns null rather than an Invalid Date, so a bad feed date reads as
 *  "no date stated" instead of poisoning a record. */
function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
