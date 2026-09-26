/**
 * The collection run
 * ==================
 *
 * Orchestrates one pass: check every enabled source, fetch what is new,
 * deduplicate, screen, extract, validate, and store.
 *
 * MODES
 *
 *   --dry-run   Fetch, extract text, and deduplicate. No AI calls, no writes to
 *               developments. Requires no API key and costs nothing. This is
 *               the mode that makes the risky half of the pipeline — HTTP,
 *               parsing, conditional requests, dedupe — testable for free.
 *   (default)   The full pass. Requires ANTHROPIC_API_KEY.
 *   --source    Limit to one source by name, for debugging a single adapter.
 *   --limit     Cap how many new articles get the expensive treatment. The
 *               safety valve: a first run against a source with a deep archive
 *               could otherwise process a hundred items at once.
 *
 * WHAT GETS PUBLISHED
 *
 * Nothing goes straight to the feed. An item reaches `review_state: 'approved'`
 * only if it passes the relevance screen, its facts are backed by quotes that
 * verify against the stored text, and its lesson questions pass the validity
 * check. Anything else lands in `needs_review` — which keeps it, rather than
 * throwing it away, so a borderline item can be looked at rather than lost.
 */

// Must come first: loads .env.local before anything reads process.env.
import './env'
import { and, eq, gte, inArray } from 'drizzle-orm'
import { db } from '../db/index'
import {
  developmentJurisdictions,
  developmentPopulations,
  developmentSources,
  developmentTerms,
  developmentTopics,
  developments,
  evidenceSpans,
  interpretationEvidence,
  interpretations,
  jurisdictions,
  lessonOptions,
  lessonQuestions,
  lessonStages,
  lessons,
  processingRuns,
  rawDocuments,
  sources,
  vocabTerms,
} from '../db/schema'
import {
  checkDevelopmentEvidence,
  checkQuestionValidity,
  checkVerificationCeiling,
  formatViolations,
  hasBlockingError,
} from '../db/invariants'
import { contentHash, findDuplicate } from './dedupe'
import { prefilter } from './prefilter'
import { fetchArticle, fetchFeed, type FeedKind } from './sources'
import {
  extractDevelopment,
  hasApiKey,
  locateQuote,
  screenRelevance,
  verifyQuotes,
  type Extraction,
} from './ai'

/**
 * Minimum extracted text length worth sending to a model.
 *
 * Set to 250 by observation, not by taste. The first value was 400, chosen on
 * the assumption that a real document is long — and it excluded genuine Irish
 * Revenue eBriefs, which run 297 to 650 characters because that is what an
 * eBrief IS: a short practitioner notice pointing at a manual update. Judging
 * documents by length is a proxy for judging them by content, and it was wrong
 * about a whole source.
 *
 * The real defences against junk are the free keyword gate and the relevance
 * screen, which read what a document says. This threshold only excludes things
 * too short to contain a quotable sentence at all.
 */
const MIN_ARTICLE_CHARS = 250

type Options = {
  dryRun: boolean
  sourceName: string | null
  /** Per-source cap on expensive processing. */
  limit: number
  /** Whole-run ceiling, as a cost stop. */
  total: number
  trigger: 'scheduled' | 'manual'
}

export type RunSummary = {
  sourcesChecked: number
  notModified: number
  sourceErrors: number
  itemsSeen: number
  itemsNew: number
  duplicatesSkipped: number
  /** Rejected by the free keyword gate, before any AI call. */
  prefiltered: number
  /** Fetched but too short to extract from. */
  tooShort: number
  screened: number
  relevant: number
  published: number
  needsReview: number
  costUsd: number
  messages: string[]
}

/* ==========================================================================
 * Entry point
 * ========================================================================== */

export async function runCollection(options: Partial<Options> = {}): Promise<RunSummary> {
  const opts: Options = {
    dryRun: options.dryRun ?? false,
    sourceName: options.sourceName ?? null,
    limit: options.limit ?? 5,
    total: options.total ?? 25,
    trigger: options.trigger ?? 'manual',
  }

  const summary: RunSummary = {
    sourcesChecked: 0,
    notModified: 0,
    sourceErrors: 0,
    itemsSeen: 0,
    itemsNew: 0,
    duplicatesSkipped: 0,
    prefiltered: 0,
    tooShort: 0,
    screened: 0,
    relevant: 0,
    published: 0,
    needsReview: 0,
    costUsd: 0,
    messages: [],
  }

  if (!opts.dryRun && !hasApiKey()) {
    summary.messages.push(
      'ANTHROPIC_API_KEY is not set — nothing was processed. Use --dry-run to exercise ' +
        'fetching, parsing and deduplication without a key.',
    )
    return summary
  }

  const sourceRows = await db
    .select()
    .from(sources)
    .where(
      opts.sourceName
        ? and(eq(sources.enabled, true), eq(sources.name, opts.sourceName))
        : eq(sources.enabled, true),
    )

  if (sourceRows.length === 0) {
    summary.messages.push('No enabled sources matched.')
    return summary
  }

  /*
   * Budget is PER SOURCE, with a whole-run ceiling on top.
   *
   * A single global budget sounds tidier but starves everything after the first
   * source: the IRS index alone has 30+ new URLs on a first run, so it consumed
   * the entire allowance and GOV.UK, Ireland and Canada were never looked at.
   * Per-source keeps coverage even, and `total` still caps the bill.
   */
  let remainingTotal = opts.total

  for (const source of sourceRows) {
    summary.sourcesChecked += 1

    if (remainingTotal <= 0) {
      summary.messages.push(
        `Stopped before ${source.name}: hit the whole-run ceiling of ${opts.total} items.`,
      )
      break
    }

    const [run] = await db
      .insert(processingRuns)
      .values({ sourceId: source.id, trigger: opts.trigger })
      .returning({ id: processingRuns.id })

    try {
      const budget = Math.min(opts.limit, remainingTotal)
      const result = await processSource(source, opts, budget, summary)
      remainingTotal -= result.consumedBudget

      await db
        .update(processingRuns)
        .set({
          finishedAt: new Date(),
          itemsSeen: result.itemsSeen,
          itemsNew: result.itemsNew,
          itemsRelevant: result.itemsRelevant,
          itemsPublished: result.itemsPublished,
          notModified: result.notModified,
          costUsd: result.costUsd.toFixed(6),
        })
        .where(eq(processingRuns.id, run.id))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      summary.sourceErrors += 1
      summary.messages.push(`${source.name}: ${message}`)

      await db
        .update(processingRuns)
        .set({ finishedAt: new Date(), error: message })
        .where(eq(processingRuns.id, run.id))

      // Record the failure on the source so a permanently broken adapter is
      // visible rather than silently yielding nothing on every run.
      await db
        .update(sources)
        .set({
          lastFetchedAt: new Date(),
          consecutiveFailures: source.consecutiveFailures + 1,
          lastError: message,
        })
        .where(eq(sources.id, source.id))
    }
  }

  return summary
}

/* ==========================================================================
 * One source
 * ========================================================================== */

async function processSource(
  source: typeof sources.$inferSelect,
  opts: Options,
  budget: number,
  summary: RunSummary,
) {
  const stats = {
    itemsSeen: 0,
    itemsNew: 0,
    itemsRelevant: 0,
    itemsPublished: 0,
    notModified: false,
    tooShort: 0,
    costUsd: 0,
    consumedBudget: 0,
  }

  const fetched = await fetchFeed({
    feedUrl: source.feedUrl,
    feedKind: source.feedKind as FeedKind,
    lastEtag: source.lastEtag,
    lastModified: source.lastModified,
    articleLinkPattern: source.articleLinkPattern,
  })

  if (fetched.kind === 'not_modified') {
    stats.notModified = true
    summary.notModified += 1
    await db
      .update(sources)
      .set({ lastFetchedAt: new Date(), lastSuccessAt: new Date(), consecutiveFailures: 0, lastError: null })
      .where(eq(sources.id, source.id))
    return stats
  }

  if (fetched.kind === 'error') {
    throw new Error(fetched.message)
  }

  stats.itemsSeen = fetched.items.length
  summary.itemsSeen += fetched.items.length

  // Store the new cache validators only after a successful parse — saving them
  // on a run that then failed would make the next run skip a feed it never
  // actually read.
  await db
    .update(sources)
    .set({
      lastFetchedAt: new Date(),
      lastSuccessAt: new Date(),
      lastEtag: fetched.etag,
      lastModified: fetched.lastModified,
      consecutiveFailures: 0,
      lastError: null,
    })
    .where(eq(sources.id, source.id))

  /* --- which URLs are genuinely new? (free) --------------------------- */
  const urls = fetched.items.map((item) => item.url)
  const known =
    urls.length > 0
      ? await db
          .select({ url: rawDocuments.url })
          .from(rawDocuments)
          .where(inArray(rawDocuments.url, urls))
      : []
  const knownUrls = new Set(known.map((k) => k.url))

  const fresh = fetched.items.filter((item) => !knownUrls.has(item.url))
  stats.itemsNew = fresh.length
  summary.itemsNew += fresh.length

  if (fresh.length === 0) return stats

  /* --- recent documents, for near-duplicate comparison ---------------- */
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)
  const recent = await db
    .select({
      id: rawDocuments.id,
      url: rawDocuments.url,
      hash: rawDocuments.contentHash,
      text: rawDocuments.rawText,
    })
    .from(rawDocuments)
    .where(gte(rawDocuments.retrievedAt, thirtyDaysAgo))

  const comparable = recent
    .filter((r): r is typeof r & { hash: string; text: string } => Boolean(r.hash && r.text))
    .map((r) => ({ id: r.id, url: r.url, hash: r.hash, text: r.text }))

  for (const item of fresh) {
    if (stats.consumedBudget >= budget) {
      summary.messages.push(
        `${source.name}: stopped at the run limit of ${budget} new items. Run again to continue.`,
      )
      break
    }

    /* --- fetch the article ------------------------------------------- */
    const article = item.inlineText && item.inlineText.length > 800
      ? { kind: 'ok' as const, text: item.inlineText, title: item.title, httpStatus: 200 }
      : await fetchArticle(item.url)

    if (article.kind === 'error') {
      summary.messages.push(`${source.name}: could not fetch ${item.url} — ${article.message}`)
      continue
    }

    if (article.text.length < MIN_ARTICLE_CHARS) {
      /*
       * Too short to extract anything defensible from — but SAY SO.
       *
       * This was a silent `continue`, and it hid a real problem: the Irish
       * source found 30 items, skipped all 30 for being too short, and
       * reported "0 errors, 0 processed" — which looks exactly like a working
       * source with nothing new. A skip that produces no output is
       * indistinguishable from success, which is the worst property a pipeline
       * step can have.
       */
      stats.tooShort += 1
      summary.tooShort += 1
      if (stats.tooShort <= 3) {
        summary.messages.push(
          `${source.name}: too short to use (${article.text.length} chars) — ${item.url}`,
        )
      }
      continue
    }

    const hash = contentHash(article.text)

    /* --- dedupe (free) ----------------------------------------------- */
    const duplicate = findDuplicate(
      { url: item.url, hash, text: article.text },
      comparable,
    )

    if (duplicate) {
      summary.duplicatesSkipped += 1
      // Still stored, and attached to the existing development as a
      // corroborating source — that is how "duplicate coverage grouped into a
      // single development with multiple sources" actually happens.
      if (!opts.dryRun) {
        await attachAsCorroboration({
          sourceId: source.id,
          item,
          article,
          hash,
          duplicateOfRawDocumentId: duplicate.match.id,
          score: duplicate.verdict.score,
        })
      }
      continue
    }

    /* --- free keyword prefilter (no AI call) -------------------------- */
    const gate = prefilter({ title: article.title ?? item.title, text: article.text })
    if (!gate.passed) {
      summary.prefiltered += 1
      continue
    }

    if (opts.dryRun) {
      stats.consumedBudget += 1
      summary.messages.push(
        `${source.name}: WOULD process "${(article.title ?? item.title ?? item.url).slice(0, 70)}" ` +
          `(${article.text.length} chars, matched: ${gate.matched.slice(0, 4).join(', ')})`,
      )
      continue
    }

    /* --- store the raw document -------------------------------------- */
    const [document] = await db
      .insert(rawDocuments)
      .values({
        sourceId: source.id,
        url: item.url,
        title: article.title ?? item.title,
        publisher: source.publisher,
        publishedAt: item.publishedAt,
        language: source.language,
        rawText: article.text,
        contentHash: hash,
        httpStatus: article.httpStatus,
      })
      .returning({ id: rawDocuments.id })

    comparable.push({ id: document.id, url: item.url, hash, text: article.text })

    /* --- stage 1: screen --------------------------------------------- */
    const screen = await screenRelevance({ title: article.title ?? item.title, text: article.text })
    stats.costUsd += screen.usage.costUsd
    summary.costUsd += screen.usage.costUsd
    summary.screened += 1
    stats.consumedBudget += 1

    if (!screen.is_relevant) continue

    stats.itemsRelevant += 1
    summary.relevant += 1

    /* --- stage 2: extract and write ---------------------------------- */
    const { extraction, usage } = await extractDevelopment({
      title: article.title ?? item.title,
      text: article.text,
      sourceName: source.name,
      publisher: source.publisher,
    })
    stats.costUsd += usage.costUsd
    summary.costUsd += usage.costUsd

    const outcome = await persistDevelopment({
      extraction,
      documentId: document.id,
      documentText: article.text,
      sourceId: source.id,
      sourceTier: source.tier,
      relevance: screen.relevance,
      model: usage.model,
    })

    if (outcome.published) {
      stats.itemsPublished += 1
      summary.published += 1
    } else {
      summary.needsReview += 1
      summary.messages.push(`Held for review: ${extraction.headline} — ${outcome.reason}`)
    }
  }

  return stats
}

/* ==========================================================================
 * Persisting an extraction
 * ========================================================================== */

/**
 * Writes an extraction, verifying every quote first.
 *
 * The order is deliberate: quotes are checked against the stored text BEFORE
 * any fact is written, and a fact whose quote fails verification is stored as
 * null — "not stated in source" — rather than stored without evidence. That
 * turns a model hallucination into an honest gap instead of a false citation.
 */
async function persistDevelopment(input: {
  extraction: Extraction
  documentId: string
  documentText: string
  sourceId: string
  sourceTier: string
  relevance: number
  model: string
}): Promise<{ published: boolean; reason: string }> {
  const { extraction, documentText } = input

  /* --- verify every quote the model returned ------------------------- */
  const allQuotes = [
    extraction.status.quote,
    extraction.published_at.quote,
    extraction.effective_at.quote,
    extraction.action_deadline_at.quote,
    extraction.primary_topic.quote,
    ...extraction.jurisdictions.map((j) => j.quote),
    ...extraction.topics.map((t) => t.quote),
    ...extraction.populations.map((p) => p.quote),
    ...extraction.grounding_quotes,
    ...extraction.lesson_questions.flatMap((q) => q.options.map((o) => o.quote)),
  ]

  const { valid, invalid, ambiguous } = verifyQuotes(documentText, allQuotes)
  const usable = new Set(valid)
  const rejectedCount = invalid.length + ambiguous.length

  /* --- create evidence spans for the usable quotes ------------------- */
  const spanIdByQuote = new Map<string, string>()
  for (const quote of valid) {
    const offsets = locateQuote(documentText, quote)
    const [row] = await db
      .insert(evidenceSpans)
      .values({
        rawDocumentId: input.documentId,
        quote,
        charStart: offsets?.start ?? null,
        charEnd: offsets?.end ?? null,
      })
      .returning({ id: evidenceSpans.id })
    spanIdByQuote.set(quote, row.id)
  }

  /** A fact survives only if its quote verified. */
  const sourced = <T>(field: { value: T | null; quote: string | null }) => {
    if (field.value === null || !field.quote || !usable.has(field.quote)) {
      return { value: null, evidenceId: null }
    }
    return { value: field.value, evidenceId: spanIdByQuote.get(field.quote) ?? null }
  }

  const status = sourced(extraction.status)
  const publishedAt = sourced(extraction.published_at)
  const effectiveAt = sourced(extraction.effective_at)
  const actionDeadline = sourced(extraction.action_deadline_at)
  const primaryTopic = sourced(extraction.primary_topic)

  /* --- verification ceiling, computed not asked --------------------- */
  const tier = input.sourceTier as 'primary_official' | 'professional' | 'press' | 'other'
  const proposedVerification =
    tier === 'primary_official' ? 'official_confirmed' : tier === 'professional' ? 'single_source' : 'unverified'
  const ceilingViolations = checkVerificationCeiling(proposedVerification, [tier])

  /* --- question validity -------------------------------------------- */
  const questionViolations = extraction.lesson_questions.flatMap((question) =>
    checkQuestionValidity({
      prompt: question.prompt,
      explanation: question.explanation,
      options: question.options.map((option) => ({
        label: option.label,
        isCorrect: option.is_correct,
        // Only a VERIFIED quote counts as a citation here.
        evidenceId: option.quote && usable.has(option.quote) ? 'verified' : null,
        isInsufficientInfo: option.is_insufficient_info,
      })),
    }),
  )

  const slug = slugify(extraction.headline)

  const row: typeof developments.$inferInsert = {
    slug,
    headline: extraction.headline,
    status: status.value,
    statusEvidenceId: status.evidenceId,
    publishedAt: publishedAt.value,
    publishedAtEvidenceId: publishedAt.evidenceId,
    effectiveAt: effectiveAt.value,
    effectiveAtEvidenceId: effectiveAt.evidenceId,
    actionDeadlineAt: actionDeadline.value,
    actionDeadlineEvidenceId: actionDeadline.evidenceId,
    primaryTopic: primaryTopic.value,
    primaryTopicEvidenceId: primaryTopic.evidenceId,
    verification: proposedVerification,
    confidence: rejectedCount === 0 && status.value !== null ? 'high' : 'medium',
    uncertaintyNote: extraction.uncertainty_note,
    relevanceScore: input.relevance.toFixed(2),
    reviewState: 'pending',
    isSeedData: false,
  }

  const evidenceViolations = checkDevelopmentEvidence(row as Record<string, unknown>)

  /* --- decide whether this publishes -------------------------------- */
  const reasons: string[] = []
  if (hasBlockingError(evidenceViolations)) reasons.push(formatViolations(evidenceViolations))
  if (hasBlockingError(ceilingViolations)) reasons.push(formatViolations(ceilingViolations))
  if (hasBlockingError(questionViolations)) {
    reasons.push(`lesson questions failed validation: ${formatViolations(questionViolations)}`)
  }
  if (invalid.length > 0) {
    reasons.push(`${invalid.length} quote(s) did not appear verbatim in the source`)
  }

  const published = reasons.length === 0
  row.reviewState = published ? 'approved' : 'needs_review'

  const [development] = await db.insert(developments).values(row).returning({ id: developments.id })

  await db.insert(developmentSources).values({
    developmentId: development.id,
    rawDocumentId: input.documentId,
    role: 'primary',
  })

  /* --- joins --------------------------------------------------------- */
  const knownJurisdictions = new Set(
    (await db.select({ code: jurisdictions.code }).from(jurisdictions)).map((j) => j.code),
  )

  for (const entry of extraction.jurisdictions) {
    // A jurisdiction we do not have configured is dropped rather than
    // auto-created: the jurisdiction list is curated configuration, and letting
    // extraction invent rows would quietly widen the app's claimed coverage.
    if (!knownJurisdictions.has(entry.code)) {
      summaryNote(`dropped unknown jurisdiction '${entry.code}'`)
      continue
    }
    await db
      .insert(developmentJurisdictions)
      .values({
        developmentId: development.id,
        jurisdictionCode: entry.code,
        role: entry.role,
        evidenceId: entry.quote && usable.has(entry.quote) ? (spanIdByQuote.get(entry.quote) ?? null) : null,
      })
      .onConflictDoNothing()
  }

  for (const entry of extraction.topics) {
    await db
      .insert(developmentTopics)
      .values({
        developmentId: development.id,
        topic: entry.topic,
        evidenceId: entry.quote && usable.has(entry.quote) ? (spanIdByQuote.get(entry.quote) ?? null) : null,
      })
      .onConflictDoNothing()
  }

  for (const entry of extraction.populations) {
    await db
      .insert(developmentPopulations)
      .values({
        developmentId: development.id,
        population: entry.population,
        evidenceId: entry.quote && usable.has(entry.quote) ? (spanIdByQuote.get(entry.quote) ?? null) : null,
      })
      .onConflictDoNothing()
  }

  /* --- interpretations ---------------------------------------------- */
  const groundingIds = extraction.grounding_quotes
    .filter((quote) => usable.has(quote))
    .map((quote) => spanIdByQuote.get(quote))
    .filter((id): id is string => Boolean(id))

  const prose: [string, string, boolean][] = [
    ['learn_summary', extraction.learn_summary, false],
    ['professional_summary', extraction.professional_summary, false],
    ['employee_effect', extraction.employee_effect, false],
    ['employer_effect', extraction.employer_effect, false],
    ['gms_effect', extraction.gms_effect, false],
    ['review_actions', extraction.review_actions, false],
    ...(extraction.uncertainty_note
      ? ([['uncertainty', extraction.uncertainty_note, true]] as [string, string, boolean][])
      : []),
  ]

  for (const [kind, body, isUncertain] of prose) {
    const [interpretation] = await db
      .insert(interpretations)
      .values({
        developmentId: development.id,
        kind: kind as (typeof interpretations.$inferInsert)['kind'],
        body,
        model: input.model,
        promptVersion: 'pipeline-v1',
        isUncertain,
      })
      .returning({ id: interpretations.id })

    if (groundingIds.length > 0) {
      await db
        .insert(interpretationEvidence)
        .values(groundingIds.map((evidenceId) => ({ interpretationId: interpretation.id, evidenceId })))
        .onConflictDoNothing()
    }
  }

  /* --- lesson ------------------------------------------------------- */
  const lessonValid = !hasBlockingError(questionViolations)

  const [lesson] = await db
    .insert(lessons)
    .values({
      developmentId: development.id,
      model: input.model,
      promptVersion: 'pipeline-v1',
      validated: lessonValid,
      validationNotes: lessonValid ? null : formatViolations(questionViolations),
    })
    .returning({ id: lessons.id })

  await db.insert(lessonStages).values([
    { lessonId: lesson.id, stage: 1, body: extraction.lesson_what_happened },
    { lessonId: lesson.id, stage: 4, body: extraction.lesson_apply_it, isSyntheticScenario: true },
    { lessonId: lesson.id, stage: 5, body: extraction.professional_summary },
  ])

  for (const [index, question] of extraction.lesson_questions.entries()) {
    const [questionRow] = await db
      .insert(lessonQuestions)
      .values({
        lessonId: lesson.id,
        stage: 2,
        ordinal: index + 1,
        kind: 'multiple_choice',
        prompt: question.prompt,
        explanation: question.explanation,
      })
      .returning({ id: lessonQuestions.id })

    for (const [optionIndex, option] of question.options.entries()) {
      await db.insert(lessonOptions).values({
        questionId: questionRow.id,
        ordinal: optionIndex + 1,
        label: option.label,
        isCorrect: option.is_correct,
        evidenceId:
          option.quote && usable.has(option.quote) ? (spanIdByQuote.get(option.quote) ?? null) : null,
        isInsufficientInfo: option.is_insufficient_info,
        whyWeaker: option.why_weaker,
      })
    }
  }

  /* --- vocabulary links (deterministic text scan) -------------------- */
  await linkTerms(development.id, [extraction.headline, extraction.learn_summary, extraction.professional_summary].join('\n'))

  return {
    published,
    reason: reasons.join('; ') || 'ok',
  }
}

/**
 * Stores a duplicate as a corroborating source on the development the original
 * document belongs to.
 *
 * This is how the brief's "duplicate coverage can be grouped into a single
 * development with multiple sources" is realised — and it also raises
 * verification, because two independent sources agreeing is exactly what
 * `corroborated` means.
 */
async function attachAsCorroboration(input: {
  sourceId: string
  item: { url: string; title: string | null; publishedAt: Date | null }
  article: { text: string; title: string | null; httpStatus: number }
  hash: string
  duplicateOfRawDocumentId: string
  score: number
}) {
  const [source] = await db.select().from(sources).where(eq(sources.id, input.sourceId))

  const [document] = await db
    .insert(rawDocuments)
    .values({
      sourceId: input.sourceId,
      url: input.item.url,
      title: input.article.title ?? input.item.title,
      publisher: source?.publisher ?? null,
      publishedAt: input.item.publishedAt,
      rawText: input.article.text,
      contentHash: input.hash,
      httpStatus: input.article.httpStatus,
    })
    .onConflictDoNothing()
    .returning({ id: rawDocuments.id })

  if (!document) return

  const [existing] = await db
    .select({ developmentId: developmentSources.developmentId })
    .from(developmentSources)
    .where(eq(developmentSources.rawDocumentId, input.duplicateOfRawDocumentId))

  if (!existing) return

  await db
    .insert(developmentSources)
    .values({
      developmentId: existing.developmentId,
      rawDocumentId: document.id,
      role: 'corroborating',
      dedupeScore: input.score.toFixed(3),
    })
    .onConflictDoNothing()

  // Two independent sources now back this development. Raise verification, but
  // only within what the tiers allow — the ceiling check still governs.
  const tiers = await db
    .select({ tier: sources.tier })
    .from(developmentSources)
    .innerJoin(rawDocuments, eq(developmentSources.rawDocumentId, rawDocuments.id))
    .innerJoin(sources, eq(rawDocuments.sourceId, sources.id))
    .where(eq(developmentSources.developmentId, existing.developmentId))

  const tierList = tiers.map((t) => t.tier as 'primary_official' | 'professional' | 'press' | 'other')
  if (tierList.length >= 2 && !hasBlockingError(checkVerificationCeiling('corroborated', tierList))) {
    await db
      .update(developments)
      .set({ verification: 'corroborated', updatedAt: new Date() })
      .where(eq(developments.id, existing.developmentId))
  }
}

/** Same deterministic term scan the seed uses. */
async function linkTerms(developmentId: string, text: string) {
  const terms = await db.select({ id: vocabTerms.id, term: vocabTerms.term }).from(vocabTerms)
  const haystack = text.toLowerCase()

  const matched = terms.filter((t) => {
    const escaped = t.term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${escaped}s?\\b`).test(haystack)
  })

  if (matched.length === 0) return
  await db
    .insert(developmentTerms)
    .values(matched.map((t) => ({ developmentId, termId: t.id })))
    .onConflictDoNothing()
}

/* ==========================================================================
 * Helpers
 * ========================================================================== */

const notes: string[] = []
function summaryNote(message: string) {
  notes.push(message)
}

/**
 * URL slug from a headline, with a short hash suffix.
 *
 * The suffix is not decoration: two tax authorities announcing similar things
 * in the same month produce near-identical headlines, and `slug` is unique.
 * Without it the second insert fails and a real development is lost.
 */
function slugify(headline: string): string {
  const base = headline
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 70)
    .replace(/^-|-$/g, '')

  const suffix = contentHash(headline).slice(0, 6)
  return `${base}-${suffix}`
}

/* ==========================================================================
 * CLI
 * ========================================================================== */

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const sourceIndex = argv.indexOf('--source')
  const limitIndex = argv.indexOf('--limit')
  const totalIndex = argv.indexOf('--total')

  const options: Partial<Options> = {
    dryRun,
    sourceName: sourceIndex !== -1 ? argv[sourceIndex + 1] : null,
    limit: limitIndex !== -1 ? Number(argv[limitIndex + 1]) : 5,
    total: totalIndex !== -1 ? Number(argv[totalIndex + 1]) : 25,
    trigger: 'manual',
  }

  console.log(
    dryRun
      ? 'Collection run (DRY RUN — no AI calls, no cost, no developments written)\n'
      : 'Collection run\n',
  )
  console.log('  Reminder: stop `npm run dev` first (PGlite is single-process).\n')

  const summary = await runCollection(options)

  console.log('')
  console.log(`  sources checked      ${summary.sourcesChecked}`)
  console.log(`  unchanged (304)      ${summary.notModified}`)
  console.log(`  source errors        ${summary.sourceErrors}`)
  console.log(`  feed items seen      ${summary.itemsSeen}`)
  console.log(`  new URLs             ${summary.itemsNew}`)
  console.log(`  duplicates grouped   ${summary.duplicatesSkipped}`)
  console.log(`  keyword-gate reject  ${summary.prefiltered}  (free — no AI call)`)
  if (!dryRun) {
    console.log(`  screened             ${summary.screened}`)
    console.log(`  judged relevant      ${summary.relevant}`)
    console.log(`  published            ${summary.published}`)
    console.log(`  held for review      ${summary.needsReview}`)
    console.log(`  cost                 $${summary.costUsd.toFixed(4)}`)
  }

  if (summary.messages.length > 0) {
    console.log('\n  notes:')
    for (const message of summary.messages.slice(0, 25)) console.log(`    - ${message}`)
    if (summary.messages.length > 25) {
      console.log(`    ... and ${summary.messages.length - 25} more`)
    }
  }
  if (notes.length > 0) {
    for (const note of [...new Set(notes)]) console.log(`    - ${note}`)
  }

  console.log('\nDone.')
}

// Only run the CLI when executed directly, not when imported by the API route.
if (process.argv[1]?.includes('run.ts') || process.argv[1]?.includes('run.js')) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('\nRun failed:', error instanceof Error ? error.message : error)
      if (error instanceof Error && error.cause) console.error('\nCause:', error.cause)
      process.exit(1)
    })
}
