/**
 * Is the evaluation ground truth actually present in the documents?
 * =================================================================
 *
 * The first real eval run scored `published_at` as MISSED on all six samples —
 * every single one. A uniform failure across every sample is almost never the
 * model; it is the test. This checks whether the expected publication dates
 * appear in the document text the model is given at all.
 *
 * Costs nothing.
 */

import '../pipeline/env'
import { eq } from 'drizzle-orm'
import { db } from '../db/index'
import { evalSamples, rawDocuments } from '../db/schema'

const DATE_PATTERN =
  /\b(\d{1,2} [A-Z][a-z]+ \d{4}|\d{4}-\d{2}-\d{2}|[A-Z][a-z]+ \d{1,2},? \d{4})\b/g

async function main() {
  const samples = await db
    .select({
      label: evalSamples.label,
      expected: evalSamples.expected,
      text: rawDocuments.rawText,
      metaDate: rawDocuments.publishedAt,
    })
    .from(evalSamples)
    .innerJoin(rawDocuments, eq(evalSamples.rawDocumentId, rawDocuments.id))

  let presentCount = 0

  for (const sample of samples) {
    const expected = sample.expected as { published_at?: string | null }
    const text = sample.text ?? ''
    const datesInText = text.match(DATE_PATTERN) ?? []

    // Is the expected date expressible from the body at all? Compare loosely:
    // the model would have to read "14 August 2026" and emit "2026-08-14".
    const expectedIso = expected.published_at ?? null
    const expectedYear = expectedIso?.slice(0, 4) ?? ''
    const plausible = datesInText.some((d) => d.includes(expectedYear))

    if (plausible) presentCount += 1

    console.log(`${sample.label}`)
    console.log(`  expected published_at : ${expectedIso ?? 'null'}`)
    console.log(`  metadata date         : ${sample.metaDate?.toISOString().slice(0, 10) ?? 'none'}`)
    console.log(`  dates in body text    : ${datesInText.length > 0 ? datesInText.join(' | ') : 'NONE'}`)
    console.log(`  derivable from text?  : ${plausible ? 'yes' : 'NO'}`)
    console.log('')
  }

  console.log(
    `${presentCount} of ${samples.length} samples have a publication date derivable from the document body.`,
  )
  if (presentCount === 0) {
    console.log('')
    console.log('The ground truth for published_at came from document METADATA, not from the')
    console.log('text the model is shown. Returning null was the correct behaviour, and the')
    console.log('test was wrong on all six samples.')
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
