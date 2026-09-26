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
    status: string | null
    effective_at: string | null
    published_at: string | null
    primary_topic: string | null
    jurisdiction_codes: string[]
    populations: string[]
    /** Substrings that must appear in a correct quote for the status field. */
    status_quote_contains: string | null
  }
  notes: string
}

const SAMPLES: EvalSeed[] = [
  {
    label: 'uk-paye-stbv',
    developmentSlug: 'gb-paye-short-term-business-visitors',
    expectedRelevant: true,
    expected: {
      status: 'official_guidance',
      effective_at: '2027-04-06',
      published_at: '2026-08-14',
      primary_topic: 'payroll',
      jurisdiction_codes: ['GB'],
      populations: ['business_travelers', 'employers'],
      status_quote_contains: 'published updated guidance',
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
      status: 'official_guidance',
      // THE point of this sample.
      effective_at: null,
      published_at: '2026-09-02',
      primary_topic: 'tax_residency',
      jurisdiction_codes: ['US'],
      populations: ['business_travelers', 'remote_workers', 'employers'],
      status_quote_contains: 'has issued guidance',
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
      status: 'proposed',
      effective_at: null,
      published_at: '2026-07-21',
      primary_topic: 'individual_income_tax',
      // Must be US-NY ONLY. Adding 'US' would make the matcher flag every US
      // assignment — a real bug this project already hit once.
      jurisdiction_codes: ['US-NY'],
      populations: ['domestic_state_workers', 'remote_workers', 'employers'],
      status_quote_contains: 'has not been adopted',
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
      status: 'enacted',
      effective_at: '2027-01-01',
      published_at: '2026-06-30',
      primary_topic: 'compensation',
      jurisdiction_codes: ['IE'],
      populations: ['expatriates', 'employers'],
      status_quote_contains: 'enacted in the Finance Act',
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
      status: 'effective',
      effective_at: '2026-06-01',
      published_at: '2026-05-19',
      primary_topic: 'withholding',
      jurisdiction_codes: ['CA'],
      populations: ['business_travelers', 'expatriates', 'employers'],
      status_quote_contains: 'is in effect for applications received',
    },
    notes: 'Already in force. Tests the top of the certainty scale.',
  },
  {
    label: 'ca-discussion-NO-STATUS',
    developmentSlug: 'us-ca-nonresident-withholding-discussion',
    expectedRelevant: true,
    expected: {
      // THE point of this sample: a document that disclaims its own authority
      // does not establish a lifecycle stage, and guessing 'discussion' would
      // be inventing one.
      status: null,
      effective_at: null,
      published_at: '2026-09-11',
      primary_topic: 'withholding',
      jurisdiction_codes: ['US-CA'],
      populations: ['domestic_state_workers', 'business_travelers', 'employers'],
      status_quote_contains: null,
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

    const nulls = Object.entries(sample.expected).filter(([, v]) => v === null).length
    nullExpectations += nulls

    await db.insert(evalSamples).values({
      label: sample.label,
      rawDocumentId: document.id,
      expectedRelevant: sample.expectedRelevant,
      expected: sample.expected,
      notes: sample.notes,
    })

    console.log(`  ${sample.label.padEnd(42)} ${nulls} field(s) expected to be NULL`)
  }

  console.log(`\n  ${SAMPLES.length} samples, ${nullExpectations} fields where the correct answer is "not stated"`)
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
