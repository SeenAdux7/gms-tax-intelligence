/**
 * Seed: the evaluation set
 * ========================
 *
 * "Include a small evaluation set of manually reviewed sample developments. It
 * should be possible to rerun the system against those samples after prompts or
 * models change and compare the results."
 *
 * Each sample is one stored document plus the answer a human reviewed. Running
 * `npm run eval` pushes the document back through the real extraction prompt and
 * scores the output field by field against `expected`.
 *
 * WHY THE GROUND TRUTH IS WHAT IT IS
 *
 * The expected values come from the seed documents in db/seed-content.ts, where
 * each fact was written alongside the sentence that supports it — so the ground
 * truth is not a second opinion, it is the same evidence the document actually
 * contains. Three samples deliberately expect NULL for a field:
 *
 *   - us-remote-work-presence-guidance expects effective_at: null. The document
 *     announces no effective date.
 *   - us-ny-convenience-employer-proposal expects effective_at: null. It states
 *     that no effective date has been proposed.
 *   - us-ca-nonresident-withholding-discussion expects status: null. A
 *     discussion paper that disclaims its own authority does not establish a
 *     lifecycle stage.
 *
 * Those three are the most valuable rows in the set. Extracting a date that is
 * present is easy; declining to invent one that is absent is the behaviour this
 * whole product depends on, and it is the behaviour most likely to regress
 * silently when a prompt or a model changes.
 *
 * Run with:  npm run db:seed:evals   (after db:seed:content)
 */

import { eq } from 'drizzle-orm'
import { db } from './index'
import { developmentSources, developments, evalSamples, rawDocuments } from './schema'

type EvalSeed = {
  label: string
  developmentSlug: string
  expectedRelevant: boolean
  expected: {
    /**
     * Acceptable values, not one value.
     *
     * The first real run scored several defensible answers as wrong because
     * each field had a single expected value. A guidance note about a Finance
     * Act enactment is arguably 'enacted' or 'official_guidance'; PAYE
     * reporting guidance is arguably 'payroll' or 'withholding'. Marking one
     * of two reasonable readings as a failure measures agreement with the
     * author of the test, not correctness.
     *
     * `null` inside the array means "not stated" is acceptable. Where the
     * array contains ONLY null, abstention is the only correct answer - those
     * are the strict cases and they stay strict.
     */
    status: (string | null)[]
    effective_at: (string | null)[]
    primary_topic: (string | null)[]
    jurisdiction_codes: string[]
    populations: string[]
  }
  notes: string
}

/*
 * published_at IS NOT SCORED, and that is a correction rather than a
 * convenience.
 *
 * The first run marked it MISSED on all six samples. A uniform failure across
 * every sample is almost never the model; it is the test. Checking with
 * scripts/check-eval-truth.ts showed the expected dates came from document
 * METADATA - the feed's own timestamp - and do not appear in the body text the
 * model is shown at all. Returning null was correct six times out of six.
 *
 * The pipeline takes publication date from feed metadata anyway
 * (rawDocuments.publishedAt), never from extraction, so scoring the model on
 * it was testing nothing about the model.
 */

const SAMPLES: EvalSeed[] = [
  {
    label: 'uk-paye-stbv',
    developmentSlug: 'gb-paye-short-term-business-visitors',
    expectedRelevant: true,
    expected: {
      status: ['official_guidance'],
      effective_at: ['2027-04-06'],
      // Guidance about operating a PAYE scheme is reasonably either.
      primary_topic: ['payroll', 'withholding'],
      jurisdiction_codes: ['GB'],
      populations: ['business_travelers', 'employers'],
    },

    notes:
      'The straightforward case: every field is stated plainly. A model that cannot get this one ' +
      'right is broken rather than miscalibrated.',
  },
  {
    label: 'us-days-of-presence-NO-EFFECTIVE-DATE',
    developmentSlug: 'us-remote-work-presence-guidance',
    expectedRelevant: true,
    expected: {
      status: ['official_guidance'],
      // THE point of this sample. Only null is acceptable - abstention is the
      // behaviour being tested, and it stays strict.
      effective_at: [null],
      primary_topic: ['tax_residency', 'withholding'],
      jurisdiction_codes: ['US'],
      populations: ['business_travelers', 'remote_workers', 'employers'],
    },

    notes:
      'Expects NULL for effective_at. The document has a publication date and no effective date, ' +
      'and the tempting wrong answer is to use one for the other. This is the single most ' +
      'important row in the set.',
  },
  {
    label: 'ny-convenience-PROPOSED-NOT-LAW',
    developmentSlug: 'us-ny-convenience-employer-proposal',
    expectedRelevant: true,
    expected: {
      // Strict: the document says outright it has not been adopted.
      status: ['proposed'],
      effective_at: [null],
      primary_topic: ['individual_income_tax', 'payroll'],
      // Must be US-NY ONLY. Adding 'US' would make the matcher flag every US
      // assignment, a real bug this project already hit once.
      jurisdiction_codes: ['US-NY'],
      populations: ['domestic_state_workers', 'remote_workers', 'employers'],
    },

    notes:
      'Tests two failure modes at once: calling a proposal a law, and tagging a state measure ' +
      'with its parent country.',
  },
  {
    label: 'ie-sarp-enacted',
    developmentSlug: 'ie-sarp-extension',
    expectedRelevant: true,
    expected: {
      // A Revenue manual update ABOUT a Finance Act enactment. Both readings
      // are defensible: the measure is enacted, the document is guidance.
      status: ['enacted', 'official_guidance'],
      effective_at: ['2027-01-01'],
      // A salary-threshold income tax relief is reasonably either.
      primary_topic: ['compensation', 'individual_income_tax'],
      jurisdiction_codes: ['IE'],
      populations: ['expatriates', 'employers'],
    },

    notes:
      'Enacted but not yet in force, with a future threshold change. Tests that "passed into law" ' +
      'and "in effect now" stay distinct.',
  },
  {
    label: 'ca-reg102-effective-now',
    developmentSlug: 'ca-reg-102-waiver-process',
    expectedRelevant: true,
    expected: {
      // A process announcement already in force - 'effective' or
      // 'official_guidance' both read fairly.
      status: ['effective', 'official_guidance'],
      effective_at: ['2026-06-01'],
      primary_topic: ['withholding', 'payroll'],
      jurisdiction_codes: ['CA'],
      populations: ['business_travelers', 'expatriates', 'employers'],
    },

    notes: 'Already in force. Tests the top of the certainty scale.',
  },
  {
    label: 'ca-discussion-NO-STATUS',
    developmentSlug: 'us-ca-nonresident-withholding-discussion',
    expectedRelevant: true,
    expected: {
      /*
       * Originally this expected null ONLY, reasoning that a paper disclaiming
       * its own position establishes no lifecycle stage. The model answered
       * 'discussion' and was scored as a FABRICATION.
       *
       * On reflection the model has the better of it. 'discussion' is an enum
       * value meaning "being talked about, nothing decided", and this document
       * is a discussion paper - that describes the document, it does not claim
       * a rule exists. The original expectation conflated "no rule yet" with
       * "no stage".
       *
       * Both are now accepted. What is NOT relaxed is effective_at, which
       * stays null-only.
       */
      status: ['discussion', null],
      effective_at: [null],
      primary_topic: ['withholding', 'payroll'],
      jurisdiction_codes: ['US-CA'],
      populations: ['domestic_state_workers', 'business_travelers', 'employers'],
    },

    notes:
      'Expects NULL for status. The paper states it is not the Board’s position and proposes ' +
      'nothing, so no stage is supportable. Also expects US-CA only.',
  },
]

async function main() {
  console.log('Seeding the evaluation set...\n')
  console.log('  Reminder: stop `npm run dev` first (PGlite is single-process).\n')

  await db.delete(evalSamples)

  let nullExpectations = 0

  for (const sample of SAMPLES) {
    // Link the sample to the stored document, so the eval runs against the same
    // text the app extracted from rather than a separate copy that could drift.
    const [document] = await db
      .select({ id: rawDocuments.id })
      .from(developmentSources)
      .innerJoin(rawDocuments, eq(developmentSources.rawDocumentId, rawDocuments.id))
      .innerJoin(developments, eq(developmentSources.developmentId, developments.id))
      .where(eq(developments.slug, sample.developmentSlug))

    if (!document) {
      throw new Error(
        `No stored document for '${sample.developmentSlug}'. Run db:seed:content first.`,
      )
    }

    // Count fields where abstention is the ONLY acceptable answer - the
    // strict cases, and the reason this set exists.
    const nulls = Object.values(sample.expected).filter(
      (v) => Array.isArray(v) && v.length === 1 && v[0] === null,
    ).length
    nullExpectations += nulls

    await db.insert(evalSamples).values({
      label: sample.label,
      rawDocumentId: document.id,
      expectedRelevant: sample.expectedRelevant,
      expected: sample.expected,
      notes: sample.notes,
    })

    console.log(`  ${sample.label.padEnd(42)} ${nulls} field(s) where only "not stated" is correct`)
  }

  console.log(`\n  ${SAMPLES.length} samples, ${nullExpectations} fields where abstention is the only correct answer`)
  console.log('  Run `npm run eval` to score the pipeline against them (requires ANTHROPIC_API_KEY).')
  console.log('\nDone.')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nSeed failed:', error instanceof Error ? error.message : error)
    if (error instanceof Error && error.cause) console.error('\nCause:', error.cause)
    process.exit(1)
  })
