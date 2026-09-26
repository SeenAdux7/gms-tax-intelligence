/**
 * Unit tests for the pipeline's deterministic parts
 * =================================================
 *
 * No network, no database, no AI. Runs in milliseconds, so it can run on every
 * change rather than only before a commit.
 *
 * The important section is QUOTE VERIFICATION. That function is the single
 * thing standing between "every claim is backed by the source" and "every
 * claim looks like it is". A model asked for a verbatim quote will usually give
 * one and will sometimes give a fluent paraphrase that reads exactly like a
 * quote — so the paraphrase cases below are the tests that matter most.
 *
 * Run with:  npm run verify:pipeline
 */

import {
  compareDocuments,
  containment,
  contentHash,
  findDuplicate,
  jaccard,
  shingles,
} from '../pipeline/dedupe'
import { prefilter } from '../pipeline/prefilter'
import { costOf, locateQuote, verifyQuotes } from '../pipeline/ai'

const failures: string[] = []

function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
  }
}

/* ==========================================================================
 * Quote verification — the guardrail
 * ========================================================================== */

console.log('\nQuote verification (the anti-fabrication guardrail):')

const DOC = [
  'HM Revenue & Customs has published updated guidance on PAYE special arrangements.',
  'The guidance sets out when an employer may operate an annual PAYE scheme for employees who spend fewer than 60 UK workdays in a tax year.',
  'Employers must apply in writing before 6 April of the relevant tax year.',
  'This guidance does not change the tax residence position of any employee.',
].join(' ')

const exact = verifyQuotes(DOC, [
  'Employers must apply in writing before 6 April of the relevant tax year.',
])
check('an exact quote verifies', exact.valid.length === 1 && exact.invalid.length === 0)

// THE critical case: a fluent, plausible paraphrase that is not in the source.
const paraphrase = verifyQuotes(DOC, [
  'Employers are required to submit a written application before 6 April each tax year.',
])
check(
  'a plausible paraphrase is REJECTED',
  paraphrase.invalid.length === 1 && paraphrase.valid.length === 0,
  'this is the case that makes every citation in the app trustworthy',
)

const invented = verifyQuotes(DOC, [
  'The guidance takes effect from 6 April 2027 for all affected employers.',
])
check('an invented but on-topic sentence is REJECTED', invented.invalid.length === 1)

// Whitespace differences are legitimate — HTML-to-text conversion creates
// them, and failing over that would reject good evidence.
const whitespace = verifyQuotes(DOC, [
  'Employers must apply in writing   before 6 April\n of the relevant tax year.',
])
check('whitespace differences still verify', whitespace.valid.length === 1)

const smartQuotes = verifyQuotes(
  'The employer’s obligation to withhold arises on the first workday in the state.',
  ["The employer's obligation to withhold arises on the first workday in the state."],
)
check('curly vs straight apostrophes still verify', smartQuotes.valid.length === 1)

// Case is NOT normalised: it carries meaning in legal text, and normalising it
// away would let a subtly altered quote through.
const caseChanged = verifyQuotes(DOC, [
  'EMPLOYERS MUST APPLY IN WRITING BEFORE 6 APRIL OF THE RELEVANT TAX YEAR.',
])
check('a case-altered quote is rejected', caseChanged.invalid.length === 1)

const fragment = verifyQuotes(DOC, ['the guidance'])
check('a too-short fragment cannot anchor a claim', fragment.invalid.length === 1)

const repeated = 'The rule applies from April. Other text here. The rule applies from April.'
const ambiguous = verifyQuotes(repeated, ['The rule applies from April.'])
check(
  'a quote appearing twice is flagged ambiguous, not accepted',
  ambiguous.ambiguous.length === 1 && ambiguous.valid.length === 0,
)

const located = locateQuote(
  DOC,
  'Employers must apply in writing before 6 April of the relevant tax year.',
)
check(
  'a verified quote gets offsets that address the original text',
  located !== null &&
    DOC.slice(located.start, located.end) ===
      'Employers must apply in writing before 6 April of the relevant tax year.',
  JSON.stringify(located),
)

const locatedLoose = locateQuote(
  DOC,
  'Employers must apply in writing   before 6 April of the relevant tax year.',
)
check(
  'offsets resolve against the original even for a whitespace-tolerant match',
  locatedLoose !== null && DOC.slice(locatedLoose.start, locatedLoose.end).includes('6 April'),
)

/* ==========================================================================
 * Keyword prefilter
 * ========================================================================== */

console.log('\nKeyword prefilter (free gate, runs before any AI call):')

check(
  'a tax document passes on a strong term',
  prefilter({ title: 'PAYE special arrangements', text: 'Guidance on withholding for employees.' })
    .passed,
)

check(
  'the UN General Assembly item is rejected',
  !prefilter({
    title: 'Secretary of State participates in 81st United Nations General Assembly',
    text: 'The Secretary of State will return to Canada following the general debate and a declaration on sustainable development.',
  }).passed,
  'this exact item passed an earlier version on the words "return" and "declaration"',
)

check(
  'a provincial infrastructure announcement is rejected',
  !prefilter({
    title: 'Canada and New Brunswick partner to build communities',
    text: 'Residents of the province will benefit from new housing. The investment supports local priorities and community growth.',
  }).passed,
  'passed an earlier version on "tax" and "resident"',
)

check(
  'three co-occurring weak terms pass',
  prefilter({
    title: 'Annual filing update',
    text: 'The revenue authority has updated the filing process. A deduction and an allowance apply.',
  }).passed,
)

check(
  'a single weak term alone does not pass',
  !prefilter({ title: 'Sports funding', text: 'A new grant will support athletes across the country.' })
    .passed,
)

/* ==========================================================================
 * Deduplication
 * ========================================================================== */

console.log('\nDeduplication:')

const A =
  'The tax authority published guidance on payroll withholding for short-term business visitors working temporarily in the country during the tax year.'
const B = A
const C =
  'Ireland has extended the Special Assignee Relief Programme to arrivals up to the end of 2029 and raised the minimum qualifying salary threshold.'

check('identical text hashes identically', contentHash(A) === contentHash(B))
check('different text hashes differently', contentHash(A) !== contentHash(C))
check(
  'punctuation and case changes do not change the hash',
  contentHash('The Rule Applies!') === contentHash('the rule applies'),
)

check(
  'identical documents are duplicates',
  compareDocuments(
    { url: 'a', hash: contentHash(A), text: A },
    { url: 'b', hash: contentHash(B), text: B },
  ).isDuplicate,
)

check(
  'unrelated documents are not duplicates',
  !compareDocuments(
    { url: 'a', hash: contentHash(A), text: A },
    { url: 'c', hash: contentHash(C), text: C },
  ).isDuplicate,
)

// The case Jaccard alone misses: a short summary of a long notice — exactly the
// shape of corroboration the brief wants grouped.
const longNotice = `${A} ${'Additional procedural detail follows in several further explanatory paragraphs. '.repeat(6)}`
const j = jaccard(shingles(longNotice), shingles(A))
const c = containment(shingles(longNotice), shingles(A))
check(
  'containment catches a short summary of a long notice where Jaccard does not',
  c > j && c >= 0.75,
  `jaccard=${j.toFixed(2)} containment=${c.toFixed(2)}`,
)
check(
  'that pair is therefore treated as duplicate coverage',
  compareDocuments(
    { url: 'long', hash: contentHash(longNotice), text: longNotice },
    { url: 'short', hash: contentHash(A), text: A },
  ).isDuplicate,
)

// Unrelated GMS documents share a lot of vocabulary. Shingles must not merge
// them on that basis — a false merge hides a real development entirely.
const gms1 =
  'Employers must review travel days and payroll arrangements for employees working temporarily in the country, and confirm withholding positions with payroll contacts.'
const gms2 =
  'Employers should review assignment cost projections and benefits for expatriate employees, and confirm allowances with human resources contacts.'
check(
  'two unrelated GMS documents are NOT merged despite shared vocabulary',
  !compareDocuments(
    { url: '1', hash: contentHash(gms1), text: gms1 },
    { url: '2', hash: contentHash(gms2), text: gms2 },
  ).isDuplicate,
  'a false merge hides a real development; a missed merge only shows two items',
)

const best = findDuplicate({ url: 'new', hash: contentHash(A), text: A }, [
  { url: 'weak', hash: contentHash(longNotice), text: longNotice },
  { url: 'exact', hash: contentHash(B), text: B },
])
check(
  'findDuplicate returns the STRONGEST match, not the first',
  best?.match.url === 'exact',
  best?.match.url,
)

/* ==========================================================================
 * Cost accounting
 * ========================================================================== */

console.log('\nCost accounting:')

check(
  'Haiku screening cost matches the published rate',
  Math.abs(costOf('claude-haiku-4-5', 1700, 150) - (1700 * 1.0 + 150 * 5.0) / 1_000_000) < 1e-9,
)
check(
  'Opus extraction cost matches the published rate',
  Math.abs(costOf('claude-opus-5', 5000, 3000) - (5000 * 5.0 + 3000 * 25.0) / 1_000_000) < 1e-9,
)
check('an unknown model costs zero rather than throwing', costOf('made-up-model', 1000, 1000) === 0)

/* -------------------------------------------------------------------------- */

console.log('')
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed.`)
  process.exit(1)
}
console.log('All pipeline checks passed.')
