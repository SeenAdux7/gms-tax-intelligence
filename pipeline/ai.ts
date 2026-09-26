/**
 * The AI stages
 * =============
 *
 * Two calls per surviving article, cheap one first:
 *
 *   1. SCREEN (Haiku 4.5) — is this even about mobile employees? Runs on
 *      everything collected. Small input, tiny output, ~$0.0025 an item.
 *   2. EXTRACT + WRITE (Opus 5) — structured facts with verbatim evidence,
 *      plain-language and professional summaries, impact analysis, and the
 *      five-stage lesson. Runs only on what survives the screen, which is
 *      roughly one item in five. ~$0.10 an item.
 *
 * The cascade is the cost model: screening everything with Opus would cost
 * about 5x more for no benefit, because the screen is a coarse yes/no that a
 * small model does well.
 *
 * WHAT THE MODEL IS AND IS NOT ALLOWED TO DO
 *
 * The model extracts and writes. It does not decide what is true. Specifically:
 *
 *   - Every fact it returns must come with a VERBATIM QUOTE, and
 *     `verifyQuotes()` checks each one is a real substring of the stored text
 *     before anything is written. A hallucinated or paraphrased quote fails the
 *     check and the field is dropped to null — "not stated in source" — rather
 *     than stored unsupported. This is the single most important function in
 *     the file.
 *   - It is instructed to return null for anything the source does not state,
 *     and the schema permits null everywhere. The brief forbids silently
 *     filling missing dates, jurisdictions, status, or populations.
 *   - It never sets verification level or review state. Those are computed from
 *     source tier by deterministic code in `db/invariants.ts`.
 *   - Dates, counts, filters, matching, and scheduling are all computed
 *     elsewhere in plain TypeScript.
 */

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

/* ==========================================================================
 * Models and pricing
 * ========================================================================== */

export const MODELS = {
  screen: 'claude-haiku-4-5',
  extract: 'claude-opus-5',
} as const

/** USD per million tokens. Used to record real spend per run. */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-opus-5': { input: 5.0, output: 25.0 },
}

export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model]
  if (!price) return 0
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000
}

export type Usage = { inputTokens: number; outputTokens: number; costUsd: number; model: string }

/**
 * Lazily constructed so importing this module never requires a key. The
 * pipeline's dry-run mode exercises fetching, extraction and dedupe with no
 * credentials at all, which is what makes the expensive half of the system
 * testable for free.
 */
let client: Anthropic | null = null

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Run the pipeline with --dry-run to exercise fetching, ' +
        'text extraction and deduplication without it.',
    )
  }
  client ??= new Anthropic()
  return client
}

/** How much of an article we send. Bounds cost and stays well inside context. */
const MAX_INPUT_CHARS = 14_000

function truncateForModel(text: string): string {
  if (text.length <= MAX_INPUT_CHARS) return text
  // Keep the head: tax notices front-load what changed, and the tail is
  // usually contact details and boilerplate.
  return `${text.slice(0, MAX_INPUT_CHARS)}\n\n[truncated]`
}

/* ==========================================================================
 * Stage 1 — relevance screen
 * ========================================================================== */

const ScreenSchema = z.object({
  is_relevant: z
    .boolean()
    .describe(
      'True only if this concerns tax, payroll, social security, treaty or policy matters ' +
        'affecting employees who work across a border or across US state lines, or their employers.',
    ),
  relevance: z.number().min(0).max(1).describe('Confidence that this is relevant, 0 to 1.'),
  reason: z.string().describe('One sentence explaining the decision.'),
})

export type ScreenResult = z.infer<typeof ScreenSchema> & { usage: Usage }

const SCREEN_PROMPT = `You screen tax and policy documents for a Global Mobility Services team.

Mark an item RELEVANT only if it plausibly affects employees working outside their home country, employees travelling or working across US state lines, or the employers who administer them. Typical relevant subjects: income tax for non-residents, tax residency tests, withholding and payroll obligations, shadow payroll, social security agreements, tax treaties, assignment allowances and benefits, equity compensation sourcing, reporting obligations for mobile staff.

Mark NOT RELEVANT: purely domestic tax matters with no cross-border or cross-state element, corporate tax unrelated to employees, customs and trade, benefits policy for local-only staff, press releases about appointments or events, scam warnings, and general service announcements.

Be decisive and lean towards rejection. A false positive costs a full analysis pass; a false negative costs one missed item that a later run may pick up anyway. Judge the document in front of you, not what it might link to.`

export async function screenRelevance(input: {
  title: string | null
  text: string
}): Promise<ScreenResult> {
  const response = await getClient().messages.parse({
    model: MODELS.screen,
    max_tokens: 512,
    system: SCREEN_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Title: ${input.title ?? '(none)'}\n\n${truncateForModel(input.text)}`,
      },
    ],
    output_config: { format: zodOutputFormat(ScreenSchema) },
  })

  const parsed = response.parsed_output
  if (!parsed) {
    // A screen that cannot be parsed is treated as NOT relevant rather than
    // passed through. Failing closed keeps a malformed response from costing an
    // Opus call, and the item will be reconsidered if the source republishes.
    return {
      is_relevant: false,
      relevance: 0,
      reason: 'Screening response could not be parsed.',
      usage: usageOf(response, MODELS.screen),
    }
  }

  return { ...parsed, usage: usageOf(response, MODELS.screen) }
}

/* ==========================================================================
 * Stage 2 — extraction, writing, and the lesson
 * ========================================================================== */

/**
 * A fact paired with the quote that supports it.
 *
 * Both fields nullable together: a value with no quote is rejected by
 * `verifyQuotes`, and the schema describes that requirement to the model in
 * the field descriptions rather than only in the prompt.
 */
const Sourced = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value: value.nullable().describe('Null if the source does not state this. Never guess.'),
    quote: z
      .string()
      .nullable()
      .describe(
        'The exact sentence from the document that states this, copied character for character. ' +
          'Null if and only if value is null.',
      ),
  })

const STATUS = z.enum(['discussion', 'proposed', 'enacted', 'official_guidance', 'effective'])
const TOPIC = z.enum([
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
const POPULATION = z.enum([
  'expatriates',
  'business_travelers',
  'remote_workers',
  'domestic_state_workers',
  'employers',
  'other',
])

const OptionSchema = z.object({
  label: z.string(),
  is_correct: z.boolean(),
  quote: z
    .string()
    .nullable()
    .describe('For a correct answer: the exact sentence that makes it correct. Null otherwise.'),
  is_insufficient_info: z
    .boolean()
    .describe(
      'True for an option meaning "there is not enough information here to decide". ' +
        'This is often the correct answer. It must not carry a quote.',
    ),
  why_weaker: z.string().nullable().describe('For an incorrect option: why it is weaker.'),
})

const QuestionSchema = z.object({
  prompt: z.string(),
  explanation: z.string().describe('Why the correct answer is stronger than the alternatives.'),
  options: z.array(OptionSchema).min(3).max(4),
})

/*
 * TWO SCHEMAS, NOT ONE — and not by choice at first.
 *
 * A single schema covering facts, both summaries, four impact fields and a
 * complete lesson with nested questions and options was rejected by the API:
 *
 *   400 invalid_request_error
 *   "The compiled grammar is too large, which would cause performance issues.
 *    Simplify your tool schemas or reduce the number of strict tools."
 *
 * Structured outputs compile the schema into a grammar that constrains
 * generation, and a deeply nested schema with several enums and an array of
 * objects containing an array of objects blows past the size limit. Nothing in
 * the documentation predicts where that limit falls; it surfaced on the first
 * real call.
 *
 * Splitting it turns out to be better design regardless:
 *
 *   - The facts call is the one that must be strictly validated. It is now
 *     small enough to reason about, and it is the only call the evaluation set
 *     needs — so the eval both costs less and tests exactly what it scores.
 *   - A malformed lesson no longer discards correctly extracted facts.
 *   - The second call reuses the first call's document prefix from the prompt
 *     cache, so sending the document twice costs far less than twice.
 */

const FactsSchema = z.object({
  headline: z.string().describe('A short factual headline, under 90 characters.'),
  status: Sourced(STATUS),
  published_at: Sourced(z.string()).describe('ISO date, YYYY-MM-DD.'),
  effective_at: Sourced(z.string()).describe('ISO date. Very often genuinely absent — return null.'),
  action_deadline_at: Sourced(z.string()).describe('ISO date, if the source states a deadline.'),
  primary_topic: Sourced(TOPIC),

  jurisdictions: z
    .array(
      z.object({
        code: z.string().describe("ISO country code, or 'US-NY' style for a US state."),
        role: z.enum(['affected', 'home', 'host']),
        quote: z.string().nullable(),
      }),
    )
    .describe(
      'Only jurisdictions the document actually concerns. For a state-level measure return the ' +
        'state code ONLY, never the parent country as well.',
    ),
  topics: z.array(z.object({ topic: TOPIC, quote: z.string().nullable() })),
  populations: z.array(z.object({ population: POPULATION, quote: z.string().nullable() })),

  uncertainty_note: z
    .string()
    .nullable()
    .describe('What remains unresolved, and what would be needed to resolve it. Null if nothing.'),
})

/** The writing pass. Looser by nature: prose and questions, not facts. */
const AnalysisSchema = z.object({
  learn_summary: z.string().describe('Plain language, no jargon. 3-5 sentences.'),
  professional_summary: z.string().describe('Concise and technical. Dates, thresholds, scope.'),
  employee_effect: z.string(),
  employer_effect: z.string(),
  gms_effect: z.string(),
  review_actions: z.string(),

  grounding_quotes: z
    .array(z.string())
    .min(1)
    .describe('The exact sentences the analysis above reasons from.'),

  lesson_what_happened: z.string().describe('Stage 1: plain language, including what is unknown.'),
  lesson_apply_it: z
    .string()
    .describe('Stage 4: a short scenario with a clearly fictional company, ending in a question.'),
  lesson_questions: z.array(QuestionSchema).min(2).max(3),
})

export type FactsExtraction = z.infer<typeof FactsSchema>
export type AnalysisExtraction = z.infer<typeof AnalysisSchema>

/** What the rest of the pipeline consumes: both passes, combined. */
export type Extraction = FactsExtraction & AnalysisExtraction
export type ExtractResult = { extraction: Extraction; usage: Usage }
export type FactsResult = { facts: FactsExtraction; usage: Usage }

const EXTRACT_PROMPT = `You prepare Global Mobility Services briefings from primary tax documents, for an audience that is learning the field.

THE RULE THAT OVERRIDES EVERYTHING ELSE: you may only state what the document states.

- Every fact must be paired with the exact sentence that supports it, copied character for character from the document. Do not paraphrase a quote, do not tidy its punctuation, do not join two sentences.
- If the document does not state something, return null for the value AND null for the quote. This applies especially to effective dates, which are frequently absent. Returning null is the correct, useful answer — a rule with no announced effective date is itself important information. Never infer an effective date from a publication date.
- For a state or provincial measure, return that jurisdiction only. Do not also return the parent country.

WRITING THE ANALYSIS

Distinguish what the source says from what it might mean. The effect fields are your reasoning; hedge them honestly ("may", "would need to be reviewed") and never assert a compliance conclusion the document does not support. If the implication is genuinely unclear, say so in uncertainty_note and say what facts would settle it.

WRITING THE QUESTIONS

Each question must have exactly one correct answer, and that answer must be backed one of two ways:
  (a) it carries a quote from the document, or
  (b) it is flagged is_insufficient_info — meaning "there is not enough information here to decide".

Option (b) is frequently the BEST question you can write. If the document is silent on when something takes effect, or whether something will be adopted, then "not enough information" is the correct answer and the wrong answers should be the plausible-looking guesses a beginner would make. Never invent a definitive legal conclusion in order to have something to test.

Incorrect options need why_weaker: a specific reason, not "this is wrong".

The scenario in lesson_apply_it must use an obviously invented company name and must end by asking what the reader would need to check — not by asserting an answer.`

/**
 * The document block, shared by both passes.
 *
 * `cache_control` marks it cacheable so the second call reads the document
 * from cache instead of paying full input price for it again. The two calls
 * happen seconds apart, well inside the 5-minute cache window, which is the
 * one situation where prompt caching clearly pays here.
 */
function documentBlock(input: {
  title: string | null
  text: string
  sourceName: string
  publisher: string
}) {
  return {
    type: 'text' as const,
    text:
      `Source: ${input.sourceName} (${input.publisher})
` +
      `Title: ${input.title ?? '(none)'}

` +
      `--- document begins ---
${truncateForModel(input.text)}
--- document ends ---`,
    cache_control: { type: 'ephemeral' as const },
  }
}

export type DocumentInput = {
  title: string | null
  text: string
  sourceName: string
  publisher: string
}

/**
 * Pass 1 — the facts.
 *
 * The call that must be right. Small strict schema, every fact paired with a
 * verbatim quote. This is the only pass the evaluation set scores, so it can be
 * measured on its own without paying for prose nobody is grading.
 */
export async function extractFacts(input: DocumentInput): Promise<FactsResult> {
  const response = await getClient().messages.parse({
    model: MODELS.extract,
    max_tokens: 8_000,
    system: EXTRACT_PROMPT,
    output_config: { effort: 'high', format: zodOutputFormat(FactsSchema) },
    messages: [{ role: 'user', content: [documentBlock(input)] }],
  })

  if (response.stop_reason === 'refusal') {
    throw new Error(
      `Fact extraction refused: ${response.stop_details?.explanation ?? 'no explanation given'}`,
    )
  }

  const parsed = response.parsed_output
  if (!parsed) throw new Error('Fact extraction could not be parsed against the schema.')

  return { facts: parsed, usage: usageOf(response, MODELS.extract) }
}

/**
 * Pass 2 — the writing and the lesson.
 *
 * Receives the facts from pass 1 so the prose cannot contradict them, and so
 * the lesson knows which fields were genuinely absent — which is what lets it
 * write an honest "not enough information" question instead of inventing an
 * answer.
 */
export async function writeAnalysis(
  input: DocumentInput,
  facts: FactsExtraction,
): Promise<{ analysis: AnalysisExtraction; usage: Usage }> {
  const absent = Object.entries({
    status: facts.status.value,
    effective_at: facts.effective_at.value,
    action_deadline_at: facts.action_deadline_at.value,
    published_at: facts.published_at.value,
  })
    .filter(([, value]) => value === null)
    .map(([field]) => field)

  const factsBrief =
    `Facts already extracted from this document, with the sentence supporting each:
` +
    JSON.stringify(facts, null, 2) +
    (absent.length > 0
      ? `

The source does NOT state: ${absent.join(', ')}. ` +
        `Do not supply values for these in your writing. Where one of them matters to a ` +
        `question, the correct answer is that there is not enough information to decide.`
      : '')

  const response = await getClient().messages.parse({
    model: MODELS.extract,
    max_tokens: 12_000,
    system: EXTRACT_PROMPT,
    output_config: { effort: 'high', format: zodOutputFormat(AnalysisSchema) },
    messages: [
      {
        role: 'user',
        // Document first so it matches pass 1's cached prefix byte for byte;
        // anything before it would invalidate the cache.
        content: [documentBlock(input), { type: 'text' as const, text: factsBrief }],
      },
    ],
  })

  if (response.stop_reason === 'refusal') {
    throw new Error(
      `Analysis refused: ${response.stop_details?.explanation ?? 'no explanation given'}`,
    )
  }

  const parsed = response.parsed_output
  if (!parsed) throw new Error('Analysis could not be parsed against the schema.')

  return { analysis: parsed, usage: usageOf(response, MODELS.extract) }
}

/**
 * Both passes, combined — what the collection pipeline calls.
 *
 * Usage is summed across the two calls so recorded cost stays accurate.
 */
export async function extractDevelopment(input: DocumentInput): Promise<ExtractResult> {
  const { facts, usage: factsUsage } = await extractFacts(input)
  const { analysis, usage: analysisUsage } = await writeAnalysis(input, facts)

  return {
    extraction: { ...facts, ...analysis },
    usage: {
      model: MODELS.extract,
      inputTokens: factsUsage.inputTokens + analysisUsage.inputTokens,
      outputTokens: factsUsage.outputTokens + analysisUsage.outputTokens,
      costUsd: factsUsage.costUsd + analysisUsage.costUsd,
    },
  }
}

/* ==========================================================================
 * The guardrail
 * ========================================================================== */

export type QuoteCheck = {
  /** Quotes that are genuine verbatim substrings of the document. */
  valid: string[]
  /** Quotes the model returned that do not appear in the document. */
  invalid: string[]
  /** Quotes appearing more than once — unusable as evidence offsets. */
  ambiguous: string[]
}

/**
 * Verifies every quote against the stored document text.
 *
 * This is the function that makes the rest of the system trustworthy. A
 * language model asked for a verbatim quote will usually give one, and will
 * sometimes give a fluent paraphrase that reads exactly like a quote. There is
 * no prompt that reliably prevents it, so the quote is checked rather than
 * trusted, and a failed quote demotes its fact to "not stated in source"
 * instead of being stored as evidence.
 *
 * Matching is exact except for whitespace and quote-character normalisation:
 * HTML-to-text conversion legitimately changes a non-breaking space or a curly
 * apostrophe, and failing a quote over that would reject good evidence. It does
 * NOT normalise wording, case, or punctuation beyond quote marks.
 */
export function verifyQuotes(documentText: string, quotes: (string | null)[]): QuoteCheck {
  const haystack = normaliseForQuoteMatching(documentText)

  const valid: string[] = []
  const invalid: string[] = []
  const ambiguous: string[] = []

  for (const quote of quotes) {
    if (!quote || quote.trim().length === 0) continue

    const needle = normaliseForQuoteMatching(quote)

    // Very short quotes are not evidence — a five-word fragment appears in many
    // sentences and cannot anchor a claim.
    if (needle.split(' ').length < 4) {
      invalid.push(quote)
      continue
    }

    const first = haystack.indexOf(needle)
    if (first === -1) {
      invalid.push(quote)
      continue
    }
    if (haystack.indexOf(needle, first + 1) !== -1) {
      ambiguous.push(quote)
      continue
    }
    valid.push(quote)
  }

  return { valid, invalid, ambiguous }
}

/**
 * Whitespace and quote-mark normalisation only.
 *
 * Deliberately does not touch case or other punctuation: those carry meaning in
 * legal text, and normalising them away would let a subtly altered quote pass.
 */
function normaliseForQuoteMatching(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Locates a verified quote in the original text and returns its offsets.
 *
 * Searches the ORIGINAL text so the offsets address the stored document, not
 * the normalised copy. Falls back to a whitespace-tolerant scan when the quote
 * only matched after normalisation.
 */
export function locateQuote(
  documentText: string,
  quote: string,
): { start: number; end: number } | null {
  const direct = documentText.indexOf(quote)
  if (direct !== -1) return { start: direct, end: direct + quote.length }

  // Build a regex from the quote's words, tolerating any whitespace between
  // them. Every word is escaped, so nothing in the quote is treated as syntax.
  const words = quote.trim().split(/\s+/).map(escapeRegex)
  if (words.length === 0) return null
  const pattern = new RegExp(words.join('[\\s\\u00a0]+'))
  const match = pattern.exec(documentText)
  if (!match) return null
  return { start: match.index, end: match.index + match[0].length }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* ==========================================================================
 * Helpers
 * ========================================================================== */

function usageOf(
  response: { usage?: { input_tokens?: number; output_tokens?: number } },
  model: string,
): Usage {
  const inputTokens = response.usage?.input_tokens ?? 0
  const outputTokens = response.usage?.output_tokens ?? 0
  return { inputTokens, outputTokens, costUsd: costOf(model, inputTokens, outputTokens), model }
}
