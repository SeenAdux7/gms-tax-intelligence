/**
 * Read queries for the Updates feed
 * =================================
 *
 * Everything here is deterministic SQL. No model is involved in filtering,
 * sorting, counting, or date handling — "use deterministic code for dates,
 * counts, filters, calculations, and status tracking."
 *
 * Note the shape of what comes back: facts and their evidence travel TOGETHER.
 * `getDevelopment()` returns each fact alongside the quote that supports it, so
 * a component physically cannot render a fact without having its citation to
 * hand. Making the right thing easy is more reliable than remembering to do it.
 */

import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  developmentJurisdictions,
  developmentPopulations,
  developments,
  developmentSources,
  developmentTopics,
  evidenceSpans,
  interpretationEvidence,
  interpretations,
  rawDocuments,
  sources,
} from '@/db/schema'
import type {
  AffectedPopulation,
  DevelopmentStatus,
  InterpretationKind,
  Topic,
  VerificationLevel,
} from './labels'

/* ==========================================================================
 * Feed
 * ========================================================================== */

export type FeedFilters = {
  /** Jurisdiction codes. A parent code also matches its children, so filtering
   *  by 'US' includes New York and California items. */
  jurisdictions?: string[]
  topics?: Topic[]
  statuses?: DevelopmentStatus[]
  populations?: AffectedPopulation[]
  /** Free text over headline and the plain-language summary. */
  search?: string
}

export type FeedItem = {
  id: string
  slug: string
  headline: string
  status: DevelopmentStatus | null
  verification: VerificationLevel
  publishedAt: string | null
  effectiveAt: string | null
  primaryTopic: Topic | null
  uncertaintyNote: string | null
  isSeedData: boolean
  jurisdictionCodes: string[]
  topics: Topic[]
  populations: AffectedPopulation[]
  /** The Learn-mode summary, for the card preview. AI-generated; the card
   *  labels it as such. */
  summary: string | null
  sourceCount: number
}

/**
 * The main feed.
 *
 * Only `approved` developments are returned. Items still in review never reach
 * a user — "create notifications and learning content only after the item meets
 * the required relevance and quality threshold."
 *
 * Ordering: effective date first where known, publication date otherwise. A GMS
 * team cares most about what is about to bite, and an item with a near
 * effective date is more urgent than one merely published recently.
 */
export async function getFeed(filters: FeedFilters = {}): Promise<FeedItem[]> {
  const conditions = [eq(developments.reviewState, 'approved')]

  if (filters.statuses?.length) {
    conditions.push(inArray(developments.status, filters.statuses))
  }

  if (filters.jurisdictions?.length) {
    // Match the code itself or any child of it (US -> US-NY, US-CA).
    const codes = filters.jurisdictions
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${developmentJurisdictions} dj
        JOIN jurisdictions j ON j.code = dj.jurisdiction_code
        WHERE dj.development_id = ${developments.id}
          AND (dj.jurisdiction_code IN ${codes} OR j.parent_code IN ${codes})
      )`,
    )
  }

  if (filters.topics?.length) {
    const topics = filters.topics
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${developmentTopics} dt
        WHERE dt.development_id = ${developments.id} AND dt.topic IN ${topics}
      )`,
    )
  }

  if (filters.populations?.length) {
    const populations = filters.populations
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${developmentPopulations} dp
        WHERE dp.development_id = ${developments.id} AND dp.population IN ${populations}
      )`,
    )
  }

  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`
    conditions.push(
      or(
        sql`${developments.headline} ILIKE ${term}`,
        sql`EXISTS (
          SELECT 1 FROM ${interpretations} i
          WHERE i.development_id = ${developments.id}
            AND i.kind = 'learn_summary'
            AND i.body ILIKE ${term}
        )`,
      )!,
    )
  }

  const rows = await db
    .select({
      id: developments.id,
      slug: developments.slug,
      headline: developments.headline,
      status: developments.status,
      verification: developments.verification,
      publishedAt: developments.publishedAt,
      effectiveAt: developments.effectiveAt,
      primaryTopic: developments.primaryTopic,
      uncertaintyNote: developments.uncertaintyNote,
      isSeedData: developments.isSeedData,
    })
    .from(developments)
    .where(and(...conditions))
    .orderBy(
      // COALESCE so items without an effective date fall back to publication
      // date rather than sinking to the bottom of the feed.
      desc(sql`COALESCE(${developments.effectiveAt}, ${developments.publishedAt})`),
      desc(developments.firstSeenAt),
    )

  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)

  // Fetch the many-to-many sets in one query each rather than per row.
  const [jurisdictionRows, topicRows, populationRows, summaryRows, sourceCounts] = await Promise.all([
    db
      .select({ developmentId: developmentJurisdictions.developmentId, code: developmentJurisdictions.jurisdictionCode })
      .from(developmentJurisdictions)
      .where(inArray(developmentJurisdictions.developmentId, ids)),
    db
      .select({ developmentId: developmentTopics.developmentId, topic: developmentTopics.topic })
      .from(developmentTopics)
      .where(inArray(developmentTopics.developmentId, ids)),
    db
      .select({ developmentId: developmentPopulations.developmentId, population: developmentPopulations.population })
      .from(developmentPopulations)
      .where(inArray(developmentPopulations.developmentId, ids)),
    db
      .select({ developmentId: interpretations.developmentId, body: interpretations.body })
      .from(interpretations)
      .where(and(inArray(interpretations.developmentId, ids), eq(interpretations.kind, 'learn_summary'))),
    db
      .select({
        developmentId: developmentSources.developmentId,
        count: sql<number>`count(*)::int`,
      })
      .from(developmentSources)
      .where(inArray(developmentSources.developmentId, ids))
      .groupBy(developmentSources.developmentId),
  ])

  const group = <T, K extends keyof T>(list: T[], key: K, pick: (item: T) => unknown) => {
    const map = new Map<string, unknown[]>()
    for (const item of list) {
      const id = item[key] as unknown as string
      const existing = map.get(id)
      if (existing) existing.push(pick(item))
      else map.set(id, [pick(item)])
    }
    return map
  }

  const jurisdictionsById = group(jurisdictionRows, 'developmentId', (r) => r.code)
  const topicsById = group(topicRows, 'developmentId', (r) => r.topic)
  const populationsById = group(populationRows, 'developmentId', (r) => r.population)
  const summaryById = new Map(summaryRows.map((r) => [r.developmentId, r.body]))
  const countById = new Map(sourceCounts.map((r) => [r.developmentId, r.count]))

  return rows.map((row) => ({
    ...row,
    status: row.status as DevelopmentStatus | null,
    verification: row.verification as VerificationLevel,
    primaryTopic: row.primaryTopic as Topic | null,
    // Dedupe: a jurisdiction attached as both 'affected' and 'host' is one place.
    jurisdictionCodes: [...new Set((jurisdictionsById.get(row.id) ?? []) as string[])],
    topics: [...new Set((topicsById.get(row.id) ?? []) as Topic[])],
    populations: [...new Set((populationsById.get(row.id) ?? []) as AffectedPopulation[])],
    summary: summaryById.get(row.id) ?? null,
    sourceCount: countById.get(row.id) ?? 0,
  }))
}

/* ==========================================================================
 * Detail
 * ========================================================================== */

/** A fact bundled with the quote that supports it. */
export type SourcedFact<T> = {
  value: T | null
  evidence: {
    quote: string
    sourceTitle: string | null
    sourceUrl: string
    publisher: string | null
  } | null
}

export type DevelopmentDetail = {
  id: string
  slug: string
  headline: string
  verification: VerificationLevel
  confidence: 'low' | 'medium' | 'high'
  uncertaintyNote: string | null
  isSeedData: boolean
  facts: {
    status: SourcedFact<DevelopmentStatus>
    publishedAt: SourcedFact<string>
    effectiveAt: SourcedFact<string>
    actionDeadlineAt: SourcedFact<string>
    primaryTopic: SourcedFact<Topic>
  }
  jurisdictions: { code: string; role: 'affected' | 'home' | 'host'; quote: string | null }[]
  topics: { topic: Topic; quote: string | null }[]
  populations: { population: AffectedPopulation; quote: string | null }[]
  interpretations: {
    kind: InterpretationKind
    body: string
    model: string | null
    isUncertain: boolean
    editedByUser: boolean
  }[]
  /** The distinct quotes the interpretation above reasons from. Shown so a
   *  reader can check the reasoning against the source rather than trust it. */
  interpretationEvidence: {
    quote: string
    sourceUrl: string
    sourceTitle: string | null
    publisher: string | null
  }[]
  documents: {
    title: string | null
    url: string
    publisher: string | null
    publishedAt: Date | null
    retrievedAt: Date
    role: string
    sourceName: string
    sourceTier: string
  }[]
}

export async function getDevelopment(slug: string): Promise<DevelopmentDetail | null> {
  const [row] = await db.select().from(developments).where(eq(developments.slug, slug))
  if (!row) return null

  /* --- resolve every evidence id to its quote and source in one query --- */
  const evidenceIds = [
    row.statusEvidenceId,
    row.publishedAtEvidenceId,
    row.effectiveAtEvidenceId,
    row.actionDeadlineEvidenceId,
    row.primaryTopicEvidenceId,
  ].filter((id): id is string => Boolean(id))

  const evidenceRows = evidenceIds.length
    ? await db
        .select({
          id: evidenceSpans.id,
          quote: evidenceSpans.quote,
          sourceTitle: rawDocuments.title,
          sourceUrl: rawDocuments.url,
          publisher: rawDocuments.publisher,
        })
        .from(evidenceSpans)
        .innerJoin(rawDocuments, eq(evidenceSpans.rawDocumentId, rawDocuments.id))
        .where(inArray(evidenceSpans.id, evidenceIds))
    : []

  const evidenceById = new Map(evidenceRows.map((e) => [e.id, e]))

  /** Pairs a value with its evidence. If the value is null the evidence is
   *  irrelevant; if the value is present the evidence is guaranteed to exist by
   *  the write-time invariant, but we still handle null defensively. */
  const sourced = <T>(value: T | null, evidenceId: string | null): SourcedFact<T> => {
    const found = evidenceId ? evidenceById.get(evidenceId) : undefined
    return {
      value: value ?? null,
      evidence: found
        ? {
            quote: found.quote,
            sourceTitle: found.sourceTitle,
            sourceUrl: found.sourceUrl,
            publisher: found.publisher,
          }
        : null,
    }
  }

  const [
    jurisdictionRows,
    topicRows,
    populationRows,
    interpretationRows,
    documentRows,
    groundingRows,
  ] = await Promise.all([
      db
        .select({
          code: developmentJurisdictions.jurisdictionCode,
          role: developmentJurisdictions.role,
          quote: evidenceSpans.quote,
        })
        .from(developmentJurisdictions)
        .leftJoin(evidenceSpans, eq(developmentJurisdictions.evidenceId, evidenceSpans.id))
        .where(eq(developmentJurisdictions.developmentId, row.id)),
      db
        .select({ topic: developmentTopics.topic, quote: evidenceSpans.quote })
        .from(developmentTopics)
        .leftJoin(evidenceSpans, eq(developmentTopics.evidenceId, evidenceSpans.id))
        .where(eq(developmentTopics.developmentId, row.id)),
      db
        .select({ population: developmentPopulations.population, quote: evidenceSpans.quote })
        .from(developmentPopulations)
        .leftJoin(evidenceSpans, eq(developmentPopulations.evidenceId, evidenceSpans.id))
        .where(eq(developmentPopulations.developmentId, row.id)),
      db
        .select({
          kind: interpretations.kind,
          body: interpretations.body,
          model: interpretations.model,
          isUncertain: interpretations.isUncertain,
          editedByUser: interpretations.editedByUser,
        })
        .from(interpretations)
        .where(eq(interpretations.developmentId, row.id)),
      db
        .select({
          title: rawDocuments.title,
          url: rawDocuments.url,
          publisher: rawDocuments.publisher,
          publishedAt: rawDocuments.publishedAt,
          retrievedAt: rawDocuments.retrievedAt,
          role: developmentSources.role,
          sourceName: sources.name,
          sourceTier: sources.tier,
        })
        .from(developmentSources)
        .innerJoin(rawDocuments, eq(developmentSources.rawDocumentId, rawDocuments.id))
        .innerJoin(sources, eq(rawDocuments.sourceId, sources.id))
        .where(eq(developmentSources.developmentId, row.id)),
      // Distinct quotes backing any interpretation of this development. The
      // same quote often grounds several sections, so DISTINCT keeps the
      // "what this is based on" list readable.
      db
        .selectDistinct({
          quote: evidenceSpans.quote,
          sourceUrl: rawDocuments.url,
          sourceTitle: rawDocuments.title,
          publisher: rawDocuments.publisher,
        })
        .from(interpretationEvidence)
        .innerJoin(interpretations, eq(interpretationEvidence.interpretationId, interpretations.id))
        .innerJoin(evidenceSpans, eq(interpretationEvidence.evidenceId, evidenceSpans.id))
        .innerJoin(rawDocuments, eq(evidenceSpans.rawDocumentId, rawDocuments.id))
        .where(eq(interpretations.developmentId, row.id)),
    ])

  return {
    id: row.id,
    slug: row.slug,
    headline: row.headline,
    verification: row.verification as VerificationLevel,
    confidence: row.confidence as 'low' | 'medium' | 'high',
    uncertaintyNote: row.uncertaintyNote,
    isSeedData: row.isSeedData,
    facts: {
      status: sourced(row.status as DevelopmentStatus | null, row.statusEvidenceId),
      publishedAt: sourced(row.publishedAt, row.publishedAtEvidenceId),
      effectiveAt: sourced(row.effectiveAt, row.effectiveAtEvidenceId),
      actionDeadlineAt: sourced(row.actionDeadlineAt, row.actionDeadlineEvidenceId),
      primaryTopic: sourced(row.primaryTopic as Topic | null, row.primaryTopicEvidenceId),
    },
    jurisdictions: jurisdictionRows as DevelopmentDetail['jurisdictions'],
    topics: topicRows as DevelopmentDetail['topics'],
    populations: populationRows as DevelopmentDetail['populations'],
    interpretations: interpretationRows as DevelopmentDetail['interpretations'],
    interpretationEvidence: groundingRows,
    documents: documentRows,
  }
}

/** Slugs of every published development — for static generation and for
 *  building prev/next navigation in the lesson flow later. */
export async function getAllDevelopmentSlugs(): Promise<string[]> {
  const rows = await db
    .select({ slug: developments.slug })
    .from(developments)
    .where(eq(developments.reviewState, 'approved'))
  return rows.map((r) => r.slug)
}

/* ==========================================================================
 * Filter options
 *
 * Derived from what is actually in the feed, so the UI never offers a filter
 * that would return nothing.
 * ========================================================================== */

export async function getFilterOptions() {
  const [jurisdictionRows, topicRows, statusRows] = await Promise.all([
    db
      .selectDistinct({ code: developmentJurisdictions.jurisdictionCode })
      .from(developmentJurisdictions)
      .innerJoin(developments, eq(developmentJurisdictions.developmentId, developments.id))
      .where(eq(developments.reviewState, 'approved')),
    db
      .selectDistinct({ topic: developmentTopics.topic })
      .from(developmentTopics)
      .innerJoin(developments, eq(developmentTopics.developmentId, developments.id))
      .where(eq(developments.reviewState, 'approved')),
    db
      .selectDistinct({ status: developments.status })
      .from(developments)
      .where(eq(developments.reviewState, 'approved')),
  ])

  return {
    jurisdictions: jurisdictionRows.map((r) => r.code).sort(),
    topics: topicRows.map((r) => r.topic as Topic).sort(),
    statuses: statusRows
      .map((r) => r.status as DevelopmentStatus | null)
      .filter((s): s is DevelopmentStatus => Boolean(s))
      .sort(),
  }
}
