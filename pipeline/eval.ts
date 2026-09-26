/**
 * The evaluation runner and scorer
 * ================================
 *
 * Pushes each stored evaluation sample back through the real extraction prompt
 * and scores the result field by field against the hand-reviewed answer.
 *
 * The scorer is deterministic and separate from the runner, so it can be unit
 * tested without spending anything — see scripts/verify-eval.ts. That matters
 * because a scorer that is itself wrong makes every measurement it produces
 * worse than no measurement.
 *
 * HOW NULLS ARE SCORED, AND WHY IT IS NOT SYMMETRIC
 *
 * Three outcomes are possible when the expected value is null:
 *
 *   expected null, got null  -> CORRECT, and reported separately as a
 *                               "correct abstention". This is the behaviour the
 *                               product depends on, so it is counted, not just
 *                               passed over.
 *   expected null, got value -> FABRICATION. The most serious failure class in
 *                               this system: the model invented a fact the
 *                               source does not contain. Counted on its own so
 *                               it can never hide inside a general accuracy
 *                               percentage.
 *   expected value, got null -> MISS. A real loss, but a safe one — the app
 *                               renders "not stated in source", which is
 *                               unhelpful rather than untrue.
 *
 * Averaging those three into one number would let fabrications and misses
 * cancel out, which is exactly backwards: they are not equally bad.
 */

// Must come first: loads .env.local before anything reads process.env.
import { basename } from 'node:path'
import './env'
import { eq } from 'drizzle-orm'
import { db } from '../db/index'
import { evalRuns, evalSamples, rawDocuments, sources } from '../db/schema'
import { MODELS, extractFacts, hasApiKey, verifyQuotes, type FactsExtraction } from './ai'
import { assertWithinBudget } from './budget'

/* ==========================================================================
 * The scorer
 * ========================================================================== */

/**
 * The hand-reviewed answer for one sample.
 *
 * Scalar fields hold a LIST of acceptable values rather than one value. Several
 * fields here have two defensible readings — a Revenue manual update about a
 * Finance Act enactment is reasonably 'enacted' or 'official_guidance' — and
 * scoring one of them as wrong measures agreement with whoever wrote the test
 * rather than correctness.
 *
 * A list containing only `null` means abstention is the ONLY acceptable answer.
 * Those are the strict cases and they are the reason this set exists.
 */
export type Expected = {
  status: (string | null)[]
  effective_at: (string | null)[]
  primary_topic: (string | null)[]
  jurisdiction_codes: string[]
  populations: string[]
}

export type FieldVerdict =
  | 'correct'
  | 'correct_abstention'
  | 'fabricated'
  | 'missed'
  | 'wrong'

export type FieldScore = { field: string; verdict: FieldVerdict; expected: unknown; actual: unknown }

export type SampleScore = {
  label: string
  fields: FieldScore[]
  /** All scalar and set fields correct. */
  passed: boolean
  counts: Record<FieldVerdict, number>
  /** Quotes the model returned that are not in the document. */
  unverifiableQuotes: number
}

/**
 * Scores one scalar field against a list of acceptable values.
 *
 * The three outcomes when abstention is involved are deliberately distinct:
 *
 *   abstention acceptable, model abstained -> correct_abstention
 *   abstention is the ONLY answer, model gave a value -> fabricated
 *   a value was required, model abstained -> missed
 *
 * Note the asymmetry in the middle case: a value is only a FABRICATION when
 * abstention was the sole acceptable answer. Where the reviewer accepted either
 * (a value or null), supplying the value is correct, not invented.
 */
function scoreScalar(
  field: string,
  acceptable: (string | null)[],
  actual: string | null,
): FieldScore {
  const nullAcceptable = acceptable.includes(null)
  const values = acceptable.filter((v): v is string => v !== null)
  const abstentionOnly = nullAcceptable && values.length === 0

  if (actual === null) {
    if (nullAcceptable) return { field, verdict: 'correct_abstention', expected: acceptable, actual }
    return { field, verdict: 'missed', expected: acceptable, actual }
  }

  if (abstentionOnly) return { field, verdict: 'fabricated', expected: acceptable, actual }

  return {
    field,
    verdict: values.includes(actual) ? 'correct' : 'wrong',
    expected: acceptable,
    actual,
  }
}

/**
 * Scores a set field (jurisdictions, populations).
 *
 * Exact set equality, not overlap. For jurisdictions that strictness is the
 * whole point: returning `['US-NY', 'US']` where `['US-NY']` was expected is
 * not "mostly right" — the extra parent code makes the matcher flag every US
 * assignment, which is a bug this project has already hit once for real.
 */
function scoreSet(field: string, expected: string[], actual: string[]): FieldScore {
  const e = [...new Set(expected)].sort()
  const a = [...new Set(actual)].sort()
  const equal = e.length === a.length && e.every((value, index) => value === a[index])

  if (equal) return { field, verdict: 'correct', expected: e, actual: a }
  // An extra value is a fabrication; a missing one is a miss. When both, the
  // fabrication is the more serious and takes precedence.
  const extra = a.filter((value) => !e.includes(value))
  return {
    field,
    verdict: extra.length > 0 ? 'fabricated' : 'missed',
    expected: e,
    actual: a,
  }
}

/**
 * Scores the FACTS pass only.
 *
 * Deliberately not the writing pass. Every expected value in the sample set is
 * a fact, so scoring prose would mean paying for output nobody grades — and it
 * halves what the eval costs to run.
 */
export function scoreExtraction(
  label: string,
  expected: Expected,
  extraction: FactsExtraction,
  documentText: string,
): SampleScore {
  const fields: FieldScore[] = [
    scoreScalar('status', expected.status, extraction.status.value ?? null),
    scoreScalar('effective_at', expected.effective_at, extraction.effective_at.value ?? null),
    // published_at is deliberately NOT scored — see the note in db/seed-evals.ts.
    // It is not derivable from the document body, and the pipeline takes it from
    // feed metadata rather than from extraction.
    scoreScalar('primary_topic', expected.primary_topic, extraction.primary_topic.value ?? null),
    scoreSet(
      'jurisdiction_codes',
      expected.jurisdiction_codes,
      extraction.jurisdictions.map((j) => j.code),
    ),
    scoreSet(
      'populations',
      expected.populations,
      extraction.populations.map((p) => p.population),
    ),
  ]

  /*
   * Is the status backed by a quote at all?
   *
   * This used to require a specific substring, which failed a model that cited
   * a different — and equally supporting — sentence from the same document.
   * Requiring one exact sentence tests recall of the reviewer's choice, not
   * whether the answer is evidenced.
   *
   * What matters is that a stated status carries SOME verbatim quote. Whether
   * that quote is really in the document is checked separately below, so a
   * fabricated one cannot pass here.
   */
  if (extraction.status.value !== null) {
    const quote = extraction.status.quote ?? ''
    fields.push({
      field: 'status_quote',
      verdict: quote.trim().length > 0 ? 'correct' : 'missed',
      expected: 'any verbatim quote supporting the status',
      actual: quote || null,
    })
  }

  /* --- quote verifiability ------------------------------------------- */
  const allQuotes = [
    extraction.status.quote,
    extraction.published_at.quote,
    extraction.effective_at.quote,
    extraction.primary_topic.quote,
    ...extraction.jurisdictions.map((j) => j.quote),
    ...extraction.populations.map((p) => p.quote),
  ]
  const { invalid, ambiguous } = verifyQuotes(documentText, allQuotes)

  const counts: Record<FieldVerdict, number> = {
    correct: 0,
    correct_abstention: 0,
    fabricated: 0,
    missed: 0,
    wrong: 0,
  }
  for (const field of fields) counts[field.verdict] += 1

  return {
    label,
    fields,
    // A pass requires no fabrication and no wrong answer. A miss is tolerated:
    // it degrades to "not stated in source", which is unhelpful but honest.
    passed: counts.fabricated === 0 && counts.wrong === 0,
    counts,
    unverifiableQuotes: invalid.length + ambiguous.length,
  }
}

/* ==========================================================================
 * The runner
 * ========================================================================== */

export type EvalSummary = {
  ran: number
  passed: number
  totals: Record<FieldVerdict, number>
  unverifiableQuotes: number
  costUsd: number
  scores: SampleScore[]
  message?: string
}

export async function runEval(): Promise<EvalSummary> {
  const empty: EvalSummary = {
    ran: 0,
    passed: 0,
    totals: { correct: 0, correct_abstention: 0, fabricated: 0, missed: 0, wrong: 0 },
    unverifiableQuotes: 0,
    costUsd: 0,
    scores: [],
  }

  if (!hasApiKey()) {
    return {
      ...empty,
      message:
        'ANTHROPIC_API_KEY is not set. The evaluation set is seeded and the scorer is tested ' +
        '(npm run verify:eval), but scoring the real pipeline needs a key.',
    }
  }

  const samples = await db.select().from(evalSamples)
  if (samples.length === 0) {
    return { ...empty, message: 'No evaluation samples. Run npm run db:seed:evals first.' }
  }

  const summary: EvalSummary = { ...empty }

  for (const sample of samples) {
    if (!sample.rawDocumentId) continue

    const [document] = await db
      .select({
        text: rawDocuments.rawText,
        title: rawDocuments.title,
        sourceName: sources.name,
        publisher: sources.publisher,
      })
      .from(rawDocuments)
      .innerJoin(sources, eq(rawDocuments.sourceId, sources.id))
      .where(eq(rawDocuments.id, sample.rawDocumentId))

    if (!document?.text) continue

    // Per sample, not per run: six Opus calls in sequence should stop at the
    // ceiling rather than only being checked before the first one.
    await assertWithinBudget(`evaluating ${sample.label}`)

    const { facts, usage } = await extractFacts({
      title: document.title,
      text: document.text,
      sourceName: document.sourceName,
      publisher: document.publisher ?? '',
    })

    const score = scoreExtraction(sample.label, sample.expected as Expected, facts, document.text)

    summary.ran += 1
    if (score.passed) summary.passed += 1
    summary.unverifiableQuotes += score.unverifiableQuotes
    summary.costUsd += usage.costUsd
    summary.scores.push(score)
    for (const verdict of Object.keys(summary.totals) as FieldVerdict[]) {
      summary.totals[verdict] += score.counts[verdict]
    }

    // Stored so runs are comparable across prompt and model changes, which is
    // the entire point the brief asks for.
    await db.insert(evalRuns).values({
      sampleId: sample.id,
      model: MODELS.extract,
      promptVersion: 'pipeline-v1',
      actual: facts,
      fieldScores: score.fields,
      passed: score.passed,
      costUsd: usage.costUsd.toFixed(6),
    })
  }

  return summary
}

/* ==========================================================================
 * CLI
 * ========================================================================== */

async function main() {
  console.log('Running the evaluation set...\n')
  console.log('  Reminder: stop `npm run dev` first (PGlite is single-process).\n')

  const summary = await runEval()

  if (summary.message) {
    console.log(`  ${summary.message}`)
    console.log('\nDone.')
    return
  }

  for (const score of summary.scores) {
    console.log(`  ${score.passed ? 'PASS' : 'FAIL'}  ${score.label}`)
    for (const field of score.fields) {
      if (field.verdict === 'correct' || field.verdict === 'correct_abstention') continue
      console.log(
        `          ${field.verdict.toUpperCase()} ${field.field}: ` +
          `expected ${JSON.stringify(field.expected)}, got ${JSON.stringify(field.actual)}`,
      )
    }
    if (score.unverifiableQuotes > 0) {
      console.log(`          ${score.unverifiableQuotes} quote(s) not found verbatim in the source`)
    }
  }

  console.log('')
  console.log(`  samples                 ${summary.ran}`)
  console.log(`  passed                  ${summary.passed}/${summary.ran}`)
  console.log(`  fields correct          ${summary.totals.correct}`)
  console.log(`  correct abstentions     ${summary.totals.correct_abstention}   (said "not stated" when it was not stated)`)
  console.log(`  FABRICATIONS            ${summary.totals.fabricated}   (invented a fact the source lacks)`)
  console.log(`  missed                  ${summary.totals.missed}   (returned null where a value existed)`)
  console.log(`  wrong                   ${summary.totals.wrong}`)
  console.log(`  unverifiable quotes     ${summary.unverifiableQuotes}`)
  console.log(`  cost                    $${summary.costUsd.toFixed(4)}`)

  if (summary.totals.fabricated > 0) {
    console.log('\n  Fabrications are the failure class this product cannot tolerate.')
    console.log('  Investigate the prompt before shipping a change that introduces any.')
  }

  console.log('\nDone.')
}

/*
 * Only run the CLI when THIS file is the entry point.
 *
 * This was `argv[1].includes('eval.ts')`, which is also true for
 * `scripts/verify-eval.ts` — so `npm run verify:eval`, advertised as free,
 * silently ran the paid evaluation as well. Substring matching on a filename
 * is not an entry-point check.
 */
const entryFile = basename(process.argv[1] ?? '')
if (entryFile === 'eval.ts' || entryFile === 'eval.js') {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('\nEval failed:', error instanceof Error ? error.message : error)
      if (error instanceof Error && error.cause) console.error('\nCause:', error.cause)
      process.exit(1)
    })
}
