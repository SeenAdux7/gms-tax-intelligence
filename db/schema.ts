/**
 * GMS Tax Intelligence — database schema
 * =======================================
 *
 * Two rules drive every design choice in this file. They come straight from the
 * build brief's "Responsible AI requirements", and they are the reason this
 * schema looks different from a normal news-aggregator schema.
 *
 *   RULE 1 — "Do not silently fill missing dates, jurisdictions, legal status,
 *             or affected populations."
 *
 *     Every extracted fact column is NULLABLE, and NULL has a specific meaning:
 *     "the source did not state this." It never means "we didn't get around to
 *     it" or "assume the default." The UI is expected to render NULL as an
 *     explicit "Not stated in source" rather than hiding the field.
 *
 *   RULE 2 — "AI-generated interpretation must be visibly distinguishable from
 *             source facts."
 *
 *     Source facts and AI interpretation live in SEPARATE TABLES. Facts go in
 *     `developments` (+ its join tables), each paired with an evidence span
 *     quoting the source verbatim. Interpretation goes in `interpretations`.
 *     Nothing in `developments` is an opinion; everything in `interpretations`
 *     is. That means the UI can style them differently without having to guess
 *     which is which, and we can never accidentally present one as the other.
 *
 * The mechanism that makes RULE 1 and RULE 2 enforceable is the EVIDENCE SPAN:
 * a verbatim quote, with character offsets, from a document we actually fetched
 * and stored. Every fact column `x` has a sibling `xEvidenceId`. The invariant,
 * checked in code at write time (see db/invariants.ts):
 *
 *     x IS NOT NULL  =>  xEvidenceId IS NOT NULL
 *
 * In other words: no claim without a quote. If we can't point at the sentence,
 * we don't get to assert the fact.
 */

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/* ==========================================================================
 * Enums
 *
 * These mirror the controlled vocabularies named in the brief. Keeping them as
 * real Postgres enums (rather than free text) is part of "use structured output
 * and validation for extracted fields" — the model cannot invent a sixth status.
 * ========================================================================== */

/** Where a development sits in its legal lifecycle. The brief is emphatic that
 *  these must never be flattened into one another: a proposal is not a law. */
export const developmentStatus = pgEnum('development_status', [
  'discussion',
  'proposed',
  'enacted',
  'official_guidance',
  'effective',
])

export const topic = pgEnum('topic', [
  'individual_income_tax',
  'tax_residency',
  'withholding',
  'payroll',
  'compensation',
  'benefits',
  'social_security',
  'tax_treaty',
  'reporting',
  'immigration_tax',
  'assignment_policy',
])

export const affectedPopulation = pgEnum('affected_population', [
  'expatriates',
  'business_travelers',
  'remote_workers',
  'domestic_state_workers',
  'employers',
  'other',
])

/** Source credibility tiers, in the brief's priority order. `tier` gates
 *  whether a development may be marked verified — see `verificationLevel`. */
export const sourceTier = pgEnum('source_tier', [
  'primary_official', // tax authorities, legislatures, treaty repositories
  'professional', // reputable tax alerts and technical publications
  'press', // national newspapers, financial reporting — discovery only
  'other',
])

export const sourceFeedKind = pgEnum('source_feed_kind', [
  'rss',
  'atom',
  'govuk_content_api',
  'json',
  'html_scrape',
])

/** How sure are we that this development is real and correctly characterised?
 *  Deliberately separate from `confidence`: a development can be well-evidenced
 *  (verification high) while its GMS impact is genuinely unclear. */
export const verificationLevel = pgEnum('verification_level', [
  'unverified', // single press mention; never shown as confirmed
  'single_source', // one credible source, not yet corroborated
  'corroborated', // two or more independent sources agree
  'official_confirmed', // a primary_official source states it directly
])

export const confidenceLevel = pgEnum('confidence_level', ['low', 'medium', 'high'])

/** Publication gate. Nothing reaches the feed until it is `approved`.
 *  "Create notifications and learning content only after the item meets the
 *  required relevance and quality threshold." */
export const reviewState = pgEnum('review_state', [
  'pending',
  'needs_review',
  'approved',
  'rejected',
])

/** Why a jurisdiction is attached to a development. A US->UK assignment needs
 *  home and host distinguished, not just "mentions UK". */
export const jurisdictionRole = pgEnum('jurisdiction_role', ['affected', 'home', 'host'])

export const jurisdictionKind = pgEnum('jurisdiction_kind', ['country', 'us_state', 'supranational'])

/** The kinds of AI-written prose we store. Every one of these is an opinion and
 *  is labelled as such in the UI. Splitting them by kind (rather than one blob)
 *  lets a user correct just the employer impact without touching the summary. */
export const interpretationKind = pgEnum('interpretation_kind', [
  'learn_summary', // plain-language "what happened", Learn Mode
  'professional_summary', // concise regulatory summary, Professional Mode
  'employee_effect',
  'employer_effect',
  'gms_effect',
  'review_actions', // possible review areas / next actions
  'uncertainty', // what remains unknown, and what would resolve it
])

export const questionKind = pgEnum('question_kind', [
  'multiple_choice',
  'select_all',
  'matching',
  'scenario',
])

export const assignmentType = pgEnum('assignment_type', [
  'long_term',
  'short_term',
  'commuter',
  'business_traveler',
  'remote_worker',
  'domestic_transfer',
])

export const assignmentStatus = pgEnum('assignment_status', [
  'planned',
  'active',
  'ended',
  'cancelled',
])

export const complianceStatus = pgEnum('compliance_status', [
  'open',
  'under_review',
  'completed',
  'overdue',
])

/** Why a synthetic assignment matched a development. Stored per-reason so the
 *  UI can explain the match instead of just asserting it. */
export const matchReason = pgEnum('match_reason', [
  'jurisdiction',
  'population',
  'date_range',
  'topic',
  'payroll_location',
])

export const vocabCategory = pgEnum('vocab_category', [
  'tax',
  'payroll',
  'assignments',
  'treaties',
  'residency',
  'social_security',
  'benefits',
  'policy',
  'compliance',
  'other',
])

/* ==========================================================================
 * Source configuration
 *
 * "Build the source system so new jurisdictions and sources can be added later
 * without redesigning the product." So sources and jurisdictions are ROWS, not
 * code. Adding Germany is an INSERT, not a refactor.
 * ========================================================================== */

export const jurisdictions = pgTable('jurisdictions', {
  /** Stable short code used everywhere else: 'US', 'US-NY', 'GB', 'IE', 'CA'. */
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  kind: jurisdictionKind('kind').notNull(),
  /** 'US-NY' -> 'US'. Lets a US federal development also surface for NY. */
  parentCode: text('parent_code'),
  enabled: boolean('enabled').notNull().default(true),
})

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    publisher: text('publisher').notNull(),
    /** Primary jurisdiction this source reports on. Nullable: OECD and other
     *  supranational sources are not tied to one jurisdiction. */
    jurisdictionCode: text('jurisdiction_code').references(() => jurisdictions.code),
    tier: sourceTier('tier').notNull(),
    feedKind: sourceFeedKind('feed_kind').notNull(),
    feedUrl: text('feed_url').notNull(),
    homepageUrl: text('homepage_url'),
    language: text('language').notNull().default('en'),
    enabled: boolean('enabled').notNull().default(true),

    /* --- polling state -------------------------------------------------- */
    /** Conditional-GET cache validators. Sending these back means an unchanged
     *  feed costs one 304 response and zero AI calls — which is what makes
     *  hourly polling as cheap as daily. */
    lastEtag: text('last_etag'),
    lastModified: text('last_modified'),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastError: text('last_error'),

    /** Set false for sources behind a paywall or robots restriction. The brief
     *  says not to depend on blocked sources for the core experience. */
    accessUnrestricted: boolean('access_unrestricted').notNull().default(true),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sources_feed_url_key').on(t.feedUrl),
    index('sources_enabled_idx').on(t.enabled),
  ],
)

/* ==========================================================================
 * Raw documents + evidence spans — the provenance floor
 *
 * Everything the app ever asserts must be traceable to a row in
 * `raw_documents` and a quote in `evidence_spans`. These two tables are treated
 * as append-only: we never rewrite history, because "keep a record of the
 * source material and generated output used for each published item".
 * ========================================================================== */

export const rawDocuments = pgTable(
  'raw_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id),

    url: text('url').notNull(),
    canonicalUrl: text('canonical_url'),
    title: text('title'),
    publisher: text('publisher'),

    /** As stated by the source. NULL = the source carried no date; we do not
     *  substitute the retrieval date, which would silently invent a fact. */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** When WE fetched it. Always known, always ours — never conflated above. */
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull().defaultNow(),

    /** Language of `rawText` as published. */
    language: text('language').notNull().default('en'),
    /** Extracted readable text, in the original language. Immutable. */
    rawText: text('raw_text'),
    /** English working text when `language` != 'en'. The original is retained
     *  above — "translate or normalize foreign-language material when needed
     *  while retaining the original source." Evidence spans always quote the
     *  ORIGINAL; translations are shown alongside, never instead. */
    translatedText: text('translated_text'),
    translationModel: text('translation_model'),

    /** SHA-256 of rawText. First-line duplicate detection: byte-identical
     *  reposts are caught here for free, before any AI call. */
    contentHash: text('content_hash'),

    httpStatus: integer('http_status'),
    fetchError: text('fetch_error'),
  },
  (t) => [
    uniqueIndex('raw_documents_url_key').on(t.url),
    index('raw_documents_hash_idx').on(t.contentHash),
    index('raw_documents_source_idx').on(t.sourceId),
  ],
)

/**
 * A verbatim quote from a raw document, with offsets so the UI can highlight it
 * in context. This is the unit of proof. Nothing else in the schema is allowed
 * to assert a fact without pointing here.
 *
 * `quote` is stored redundantly (it could be derived from the offsets) on
 * purpose: if an upstream page is edited or disappears, we still hold the exact
 * text our claim was based on.
 */
export const evidenceSpans = pgTable(
  'evidence_spans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rawDocumentId: uuid('raw_document_id')
      .notNull()
      .references(() => rawDocuments.id),
    /** Exact text as published. Never paraphrased — that would defeat the point. */
    quote: text('quote').notNull(),
    charStart: integer('char_start'),
    charEnd: integer('char_end'),
    /** Optional note on what this span is being used to support. */
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('evidence_spans_doc_idx').on(t.rawDocumentId)],
)

/* ==========================================================================
 * Developments — deduplicated source FACTS only
 *
 * One development = one real-world regulatory event, which may have been
 * covered by several documents ("duplicate coverage can be grouped into a
 * single development with multiple sources").
 *
 * Note the shape of this table: it is almost entirely NULLABLE fact columns,
 * each with an `*EvidenceId` beside it. There is no `summary` column and no
 * `impact` column — those are opinions and live in `interpretations`.
 * ========================================================================== */

export const developments = pgTable(
  'developments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),

    /** Short factual headline. Nullable evidence because a headline we write
     *  ourselves is a summary, not a quote; when it IS lifted from the source,
     *  we record the span. */
    headline: text('headline').notNull(),
    headlineEvidenceId: uuid('headline_evidence_id').references(() => evidenceSpans.id),

    /** Legal status. NULL = the source did not make the status clear. The UI
     *  must then say "Status not stated in source" rather than guessing, and
     *  the item should be routed to review. */
    status: developmentStatus('status'),
    statusEvidenceId: uuid('status_evidence_id').references(() => evidenceSpans.id),

    /** Date the measure was published/announced by the authority. */
    publishedAt: date('published_at'),
    publishedAtEvidenceId: uuid('published_at_evidence_id').references(() => evidenceSpans.id),

    /** Date it takes (or took) effect. Very often genuinely absent from the
     *  source — that absence is itself useful information for a GMS team. */
    effectiveAt: date('effective_at'),
    effectiveAtEvidenceId: uuid('effective_at_evidence_id').references(() => evidenceSpans.id),

    /** Deadline a client may need to act by, when the source states one. */
    actionDeadlineAt: date('action_deadline_at'),
    actionDeadlineEvidenceId: uuid('action_deadline_evidence_id').references(() => evidenceSpans.id),

    /** Primary topic for filtering; finer-grained topics in the join table. */
    primaryTopic: topic('primary_topic'),
    primaryTopicEvidenceId: uuid('primary_topic_evidence_id').references(() => evidenceSpans.id),

    verification: verificationLevel('verification').notNull().default('unverified'),
    /** Confidence in our CHARACTERISATION, not in whether the event happened. */
    confidence: confidenceLevel('confidence').notNull().default('low'),
    /** Free-text note on what is unresolved. Surfaced in the UI; never empty
     *  just because it looks untidy. */
    uncertaintyNote: text('uncertainty_note'),

    reviewState: reviewState('review_state').notNull().default('pending'),
    /** Relevance score from the Haiku screening pass, 0.00–1.00. Kept so we can
     *  measure classifier accuracy against the eval set later. */
    relevanceScore: numeric('relevance_score', { precision: 3, scale: 2 }),

    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /** True for hand-written demo rows. Lets the UI badge them honestly and
     *  lets the eval harness exclude them from accuracy measurements. */
    isSeedData: boolean('is_seed_data').notNull().default(false),
  },
  (t) => [
    uniqueIndex('developments_slug_key').on(t.slug),
    index('developments_review_idx').on(t.reviewState),
    index('developments_effective_idx').on(t.effectiveAt),
    index('developments_status_idx').on(t.status),
  ],
)

/** development <-> raw_document. A development with three sources has three
 *  rows here, which is how "grouped duplicate coverage" is represented. */
export const developmentSources = pgTable(
  'development_sources',
  {
    developmentId: uuid('development_id')
      .notNull()
      .references(() => developments.id, { onDelete: 'cascade' }),
    rawDocumentId: uuid('raw_document_id')
      .notNull()
      .references(() => rawDocuments.id),
    /** 'primary' = the document we base facts on; 'corroborating' = agrees;
     *  'discovery' = how we found out (often press, which per the brief cannot
     *  alone support presenting a rule as confirmed). */
    role: text('role').notNull().default('primary'),
    /** Similarity score from the dedupe pass, for tuning and measurement. */
    dedupeScore: numeric('dedupe_score', { precision: 4, scale: 3 }),
  },
  (t) => [unique('development_sources_key').on(t.developmentId, t.rawDocumentId)],
)

export const developmentJurisdictions = pgTable(
  'development_jurisdictions',
  {
    developmentId: uuid('development_id')
      .notNull()
      .references(() => developments.id, { onDelete: 'cascade' }),
    jurisdictionCode: text('jurisdiction_code')
      .notNull()
      .references(() => jurisdictions.code),
    role: jurisdictionRole('role').notNull().default('affected'),
    evidenceId: uuid('evidence_id').references(() => evidenceSpans.id),
  },
  (t) => [unique('development_jurisdictions_key').on(t.developmentId, t.jurisdictionCode, t.role)],
)

export const developmentTopics = pgTable(
  'development_topics',
  {
    developmentId: uuid('development_id')
      .notNull()
      .references(() => developments.id, { onDelete: 'cascade' }),
    topic: topic('topic').notNull(),
    evidenceId: uuid('evidence_id').references(() => evidenceSpans.id),
  },
  (t) => [unique('development_topics_key').on(t.developmentId, t.topic)],
)

export const developmentPopulations = pgTable(
  'development_populations',
  {
    developmentId: uuid('development_id')
      .notNull()
      .references(() => developments.id, { onDelete: 'cascade' }),
    population: affectedPopulation('population').notNull(),
    evidenceId: uuid('evidence_id').references(() => evidenceSpans.id),
  },
  (t) => [unique('development_populations_key').on(t.developmentId, t.population)],
)

/* ==========================================================================
 * Interpretations — everything the AI believes, kept apart from the facts
 * ========================================================================== */

export const interpretations = pgTable(
  'interpretations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    developmentId: uuid('development_id')
      .notNull()
      .references(() => developments.id, { onDelete: 'cascade' }),
    kind: interpretationKind('kind').notNull(),
    body: text('body').notNull(),

    /* --- provenance of the GENERATION itself ----------------------------- */
    /** Which model wrote this, e.g. 'claude-opus-5'. Needed to re-run the eval
     *  set after a model change and compare, per the brief. */
    model: text('model'),
    promptVersion: text('prompt_version'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),

    /** Hedging language is required, not optional. When the evidence doesn't
     *  support a conclusion this must be true and the body must say what facts
     *  are still needed. */
    isUncertain: boolean('is_uncertain').notNull().default(false),

    /* --- human oversight ------------------------------------------------- */
    /** "Allow a user to correct summaries, classifications, dates..." */
    editedByUser: boolean('edited_by_user').notNull().default(false),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => [unique('interpretations_key').on(t.developmentId, t.kind)],
)

/** Grounds an interpretation in specific quotes. An interpretation with no rows
 *  here is unsupported opinion and must not be published. */
export const interpretationEvidence = pgTable(
  'interpretation_evidence',
  {
    interpretationId: uuid('interpretation_id')
      .notNull()
      .references(() => interpretations.id, { onDelete: 'cascade' }),
    evidenceId: uuid('evidence_id')
      .notNull()
      .references(() => evidenceSpans.id),
  },
  (t) => [unique('interpretation_evidence_key').on(t.interpretationId, t.evidenceId)],
)

/* ==========================================================================
 * Vocabulary
 * ========================================================================== */

export const vocabTerms = pgTable(
  'vocab_terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    term: text('term').notNull(),
    /** One sentence, plain English. */
    definition: text('definition').notNull(),
    whyItMatters: text('why_it_matters').notNull(),
    /** Concrete example involving an employee or employer. */
    example: text('example').notNull(),
    commonMisunderstanding: text('common_misunderstanding'),
    /** Formal definition, only when we have a real source for it. NULL rather
     *  than an invented legal-sounding sentence. */
    formalDefinition: text('formal_definition'),
    formalDefinitionSourceUrl: text('formal_definition_source_url'),
    category: vocabCategory('category').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('vocab_terms_slug_key').on(t.slug), index('vocab_terms_cat_idx').on(t.category)],
)

export const vocabRelations = pgTable(
  'vocab_relations',
  {
    termId: uuid('term_id')
      .notNull()
      .references(() => vocabTerms.id, { onDelete: 'cascade' }),
    relatedTermId: uuid('related_term_id')
      .notNull()
      .references(() => vocabTerms.id, { onDelete: 'cascade' }),
  },
  (t) => [unique('vocab_relations_key').on(t.termId, t.relatedTermId)],
)

/** Terms mentioned in a development, so the UI can make them tappable. */
export const developmentTerms = pgTable(
  'development_terms',
  {
    developmentId: uuid('development_id')
      .notNull()
      .references(() => developments.id, { onDelete: 'cascade' }),
    termId: uuid('term_id')
      .notNull()
      .references(() => vocabTerms.id, { onDelete: 'cascade' }),
  },
  (t) => [unique('development_terms_key').on(t.developmentId, t.termId)],
)

/* ==========================================================================
 * Lessons — the 5-stage swipe-through flow
 *
 * The brief's hardest constraint lives here: "The system should never invent a
 * definitive legal conclusion merely to create a quiz." The schema enforces it
 * structurally — a correct option must carry `evidenceId`, OR must be flagged
 * `isInsufficientInfo`, meaning "not enough information to decide" is itself
 * the right answer. See db/invariants.ts.
 * ========================================================================== */

export const lessons = pgTable(
  'lessons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    developmentId: uuid('development_id')
      .notNull()
      .references(() => developments.id, { onDelete: 'cascade' }),
    model: text('model'),
    promptVersion: text('prompt_version'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set false by the question validator when any question fails the
     *  evidence check. Unvalidated lessons are never served. */
    validated: boolean('validated').notNull().default(false),
    validationNotes: text('validation_notes'),
  },
  (t) => [uniqueIndex('lessons_development_key').on(t.developmentId)],
)

/** Stage prose for stages 1 (what happened), 4 (apply it), 5 (professional
 *  summary). Stages 2 and 3 are driven by `lessonQuestions`. */
export const lessonStages = pgTable(
  'lesson_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    /** 1..5, matching the brief's stage table. */
    stage: integer('stage').notNull(),
    body: text('body').notNull(),
    /** Stage 4's fictional client scenario. Always synthetic, always labelled. */
    isSyntheticScenario: boolean('is_synthetic_scenario').notNull().default(false),
  },
  (t) => [unique('lesson_stages_key').on(t.lessonId, t.stage)],
)

export const lessonQuestions = pgTable(
  'lesson_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    stage: integer('stage').notNull().default(2),
    ordinal: integer('ordinal').notNull(),
    kind: questionKind('kind').notNull(),
    prompt: text('prompt').notNull(),
    /** Why the correct answer is stronger than the alternatives (stage 3). */
    explanation: text('explanation').notNull(),
  },
  (t) => [unique('lesson_questions_key').on(t.lessonId, t.stage, t.ordinal)],
)

export const lessonOptions = pgTable(
  'lesson_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => lessonQuestions.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    label: text('label').notNull(),
    isCorrect: boolean('is_correct').notNull().default(false),

    /** The quote that makes this option correct. Required when `isCorrect` is
     *  true and `isInsufficientInfo` is false — this is the anti-fabrication
     *  guard. No quote, no assertable answer. */
    evidenceId: uuid('evidence_id').references(() => evidenceSpans.id),

    /** Marks the "there isn't enough information to say" option. When this is
     *  the correct answer, no evidence span is required — precisely because the
     *  sources don't support a conclusion. The brief asks the lesson to say so
     *  and ask what further facts would be needed. */
    isInsufficientInfo: boolean('is_insufficient_info').notNull().default(false),

    /** Shown after answering: why this distractor is weaker. */
    whyWeaker: text('why_weaker'),
  },
  (t) => [unique('lesson_options_key').on(t.questionId, t.ordinal)],
)

/* ==========================================================================
 * Synthetic assignment layer
 *
 * "The first version should use synthetic assignment data only." `isSynthetic`
 * defaults to true and there is deliberately no code path that sets it false.
 * ========================================================================== */

export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Anonymous identifier, e.g. 'EMP-0042'. Never a real name. */
    employeeRef: text('employee_ref').notNull(),
    homeJurisdiction: text('home_jurisdiction')
      .notNull()
      .references(() => jurisdictions.code),
    hostJurisdiction: text('host_jurisdiction')
      .notNull()
      .references(() => jurisdictions.code),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    type: assignmentType('type').notNull(),
    status: assignmentStatus('status').notNull(),
    /** Jurisdiction codes where payroll is actually run — often neither home
     *  nor host, which is exactly the kind of thing a shadow-payroll rule hits. */
    payrollLocations: text('payroll_locations').array().notNull().default([]),
    /** e.g. ['base_salary','bonus','equity','allowances']. */
    compensationCategories: text('compensation_categories').array().notNull().default([]),
    benefits: text('benefits').array().notNull().default([]),
    /** Always true in v1. Guards against real employee data entering the app. */
    isSynthetic: boolean('is_synthetic').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('assignments_employee_ref_key').on(t.employeeRef),
    index('assignments_corridor_idx').on(t.homeJurisdiction, t.hostJurisdiction),
  ],
)

export const assignmentDeadlines = pgTable(
  'assignment_deadlines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    dueDate: date('due_date').notNull(),
    status: complianceStatus('status').notNull().default('open'),
  },
  (t) => [index('assignment_deadlines_due_idx').on(t.dueDate)],
)

/**
 * A development matched to a synthetic assignment.
 *
 * The brief is explicit that this is "a potential review item, not a legal
 * determination", so the table stores an `explanation` and the specific
 * `reasons` that fired. Matching itself is deterministic TypeScript — set
 * overlap on jurisdiction, population, topic and date range — not an AI call.
 * "Use deterministic code for dates, counts, filters, calculations."
 */
export const developmentAssignmentMatches = pgTable(
  'development_assignment_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    developmentId: uuid('development_id')
      .notNull()
      .references(() => developments.id, { onDelete: 'cascade' }),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    reasons: matchReason('reasons').array().notNull(),
    /** Human-readable "why this matched", assembled from `reasons` in code. */
    explanation: text('explanation').notNull(),
    reviewStatus: complianceStatus('review_status').notNull().default('open'),
    matchedAt: timestamp('matched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('development_assignment_matches_key').on(t.developmentId, t.assignmentId)],
)

/* ==========================================================================
 * Learner state
 *
 * Single-user in v1 — "not required: a complex enterprise permissions system."
 * `userId` exists as a plain text column so multi-user is a later migration
 * rather than a rewrite, and defaults to 'local'.
 * ========================================================================== */

export const savedItems = pgTable(
  'saved_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().default('local'),
    /** 'development' | 'vocab_term'. */
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    /** Marks a vocabulary term the user flagged as hard, feeding Review mode. */
    markedDifficult: boolean('marked_difficult').notNull().default(false),
    savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('saved_items_key').on(t.userId, t.entityType, t.entityId)],
)

/** Every answer attempt. Drives question accuracy on the dashboard and the
 *  spaced-repetition schedule in Review mode. */
export const questionAttempts = pgTable(
  'question_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().default('local'),
    questionId: uuid('question_id')
      .notNull()
      .references(() => lessonQuestions.id, { onDelete: 'cascade' }),
    wasCorrect: boolean('was_correct').notNull(),
    selectedOptionIds: uuid('selected_option_ids').array().notNull().default([]),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('question_attempts_user_idx').on(t.userId, t.attemptedAt)],
)

/** Spaced repetition state per vocabulary term. Intervals are computed in
 *  deterministic code, not by a model. */
export const termReviewState = pgTable(
  'term_review_state',
  {
    userId: text('user_id').notNull().default('local'),
    termId: uuid('term_id')
      .notNull()
      .references(() => vocabTerms.id, { onDelete: 'cascade' }),
    correctStreak: integer('correct_streak').notNull().default(0),
    incorrectCount: integer('incorrect_count').notNull().default(0),
    /** Next time this term should resurface. "Bring weaker terms back more
     *  frequently over time." */
    dueAt: timestamp('due_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => [unique('term_review_state_key').on(t.userId, t.termId)],
)

/* ==========================================================================
 * Operations, corrections, and evaluation
 * ========================================================================== */

/** One row per ingestion run per source. Gives the dashboard "processing
 *  failures and source availability" and tracks real AI spend. */
export const processingRuns = pgTable(
  'processing_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').references(() => sources.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** 'scheduled' | 'manual' — the brief asks for a manual refresh for dev. */
    trigger: text('trigger').notNull().default('scheduled'),
    itemsSeen: integer('items_seen').notNull().default(0),
    itemsNew: integer('items_new').notNull().default(0),
    itemsRelevant: integer('items_relevant').notNull().default(0),
    itemsPublished: integer('items_published').notNull().default(0),
    /** True when the feed returned 304 Not Modified — the cheap, common case. */
    notModified: boolean('not_modified').notNull().default(false),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    error: text('error'),
  },
  (t) => [index('processing_runs_started_idx').on(t.startedAt)],
)

/** Audit trail of user corrections. Feeds "user corrections and recurring error
 *  types" in the quality metrics, and is why corrections are safe to allow. */
export const corrections = pgTable(
  'corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().default('local'),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    field: text('field').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    note: text('note'),
    correctedAt: timestamp('corrected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('corrections_entity_idx').on(t.entityType, t.entityId)],
)

/**
 * Hand-labelled evaluation set. "Include a small evaluation set of manually
 * reviewed sample developments. It should be possible to rerun the system
 * against those samples after prompts or models change and compare the results."
 *
 * `expected` holds the human-verified answer; a run writes `actual` so the two
 * can be diffed per field.
 */
export const evalSamples = pgTable(
  'eval_samples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    label: text('label').notNull(),
    rawDocumentId: uuid('raw_document_id').references(() => rawDocuments.id),
    /** Ground truth: is this GMS-relevant at all? */
    expectedRelevant: boolean('expected_relevant').notNull(),
    /** Ground-truth extracted fields, as JSON, reviewed by hand. */
    expected: jsonb('expected').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('eval_samples_label_key').on(t.label)],
)

/** One scored attempt of the pipeline against one eval sample. */
export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sampleId: uuid('sample_id')
      .notNull()
      .references(() => evalSamples.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
    actual: jsonb('actual').notNull(),
    /** Per-field pass/fail, computed deterministically by the scorer. */
    fieldScores: jsonb('field_scores').notNull(),
    passed: boolean('passed').notNull(),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  },
  (t) => [index('eval_runs_sample_idx').on(t.sampleId, t.ranAt)],
)
