/**
 * Duplicate detection
 * ===================
 *
 * "Detect duplicate or closely related coverage of the same development."
 *
 * Three layers, cheapest first, and none of them uses a model. Two documents
 * covering one announcement is a text-similarity question, and text similarity
 * is a solved deterministic problem — an AI call here would cost money per
 * comparison, give a different answer on different days, and be unable to
 * explain itself.
 *
 *   1. URL — have we already stored this exact page? Free.
 *   2. Content hash — byte-identical text. Catches syndicated reposts and the
 *      same page fetched under two URLs. Free.
 *   3. Shingle similarity — near-duplicates: a tax authority's own notice and a
 *      professional alert describing it. Cheap, and the score is stored so the
 *      threshold can be tuned against the eval set later.
 *
 * The ordering matters for cost: layers 1 and 2 run before any AI call, so a
 * repost never reaches the relevance screen.
 */

import { createHash } from 'node:crypto'

/** SHA-256 of the normalised text. Stored on `raw_documents.content_hash`. */
export function contentHash(text: string): string {
  return createHash('sha256').update(normaliseForHashing(text)).digest('hex')
}

/**
 * Aggressive normalisation, used ONLY for hashing and similarity — never for
 * storage or display.
 *
 * Lowercasing and stripping punctuation means a page that only changed its
 * smart quotes still hashes the same. The original text is kept verbatim in
 * `raw_documents.raw_text`, because evidence spans are character offsets into
 * it and must survive exactly.
 */
function normaliseForHashing(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Word-level shingles (overlapping n-grams).
 *
 * Shingles rather than a bag of words: two documents about completely
 * different tax topics share a lot of individual words ("employer", "tax",
 * "guidance", "employee"), so bag-of-words similarity runs high on unrelated
 * GMS content and would merge distinct developments. Requiring runs of five
 * consecutive words makes an accidental match very unlikely.
 */
const SHINGLE_SIZE = 5

export function shingles(text: string, size = SHINGLE_SIZE): Set<string> {
  const words = normaliseForHashing(text).split(' ').filter(Boolean)
  const set = new Set<string>()
  if (words.length < size) {
    if (words.length > 0) set.add(words.join(' '))
    return set
  }
  for (let i = 0; i <= words.length - size; i++) {
    set.add(words.slice(i, i + size).join(' '))
  }
  return set
}

/**
 * Jaccard similarity of two shingle sets: |intersection| / |union|.
 *
 * Symmetric and bounded 0–1. Note the asymmetry problem it does NOT solve: a
 * short press summary of a long official notice scores low on Jaccard because
 * the union is dominated by the long document. `containment` below handles that
 * case, and the caller uses both.
 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  // Iterate the smaller set.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  for (const shingle of small) if (large.has(shingle)) intersection += 1
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * How much of the SMALLER document appears in the larger one.
 *
 * This is the measure that catches "short alert about a long notice", which is
 * exactly the shape of the corroboration the brief wants grouped: a
 * professional publication summarising an official announcement. Jaccard alone
 * misses it.
 */
export function containment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let shared = 0
  for (const shingle of small) if (large.has(shingle)) shared += 1
  return shared / small.size
}

/* --------------------------------------------------------------------------
 * Thresholds
 *
 * Deliberately conservative. A false merge is much worse than a missed one: it
 * hides a real development behind an unrelated one, and the reader never learns
 * it existed. A missed merge only means the feed shows two items instead of one.
 * -------------------------------------------------------------------------- */

export const DUPLICATE_THRESHOLDS = {
  /** Same length, overwhelmingly the same text. */
  jaccard: 0.55,
  /** The smaller document is almost entirely inside the larger. */
  containment: 0.75,
} as const

export type DuplicateVerdict = {
  isDuplicate: boolean
  /** Which measure fired, for the stored dedupe score and for tuning. */
  measure: 'url' | 'hash' | 'jaccard' | 'containment' | null
  score: number
}

export function compareDocuments(
  a: { url: string; hash: string; text: string },
  b: { url: string; hash: string; text: string },
): DuplicateVerdict {
  if (a.url === b.url) return { isDuplicate: true, measure: 'url', score: 1 }
  if (a.hash === b.hash) return { isDuplicate: true, measure: 'hash', score: 1 }

  const shinglesA = shingles(a.text)
  const shinglesB = shingles(b.text)

  const j = jaccard(shinglesA, shinglesB)
  if (j >= DUPLICATE_THRESHOLDS.jaccard) {
    return { isDuplicate: true, measure: 'jaccard', score: j }
  }

  const c = containment(shinglesA, shinglesB)
  if (c >= DUPLICATE_THRESHOLDS.containment) {
    return { isDuplicate: true, measure: 'containment', score: c }
  }

  // Report the stronger of the two even when neither fired, so a near-miss is
  // visible when tuning rather than indistinguishable from no similarity.
  return { isDuplicate: false, measure: null, score: Math.max(j, c) }
}

/**
 * Finds which of a set of existing documents (if any) a candidate duplicates.
 *
 * Returns the STRONGEST match rather than the first. With several candidates
 * above threshold, attaching to the closest keeps groups coherent; attaching to
 * whichever happened to be checked first makes grouping depend on row order.
 */
export function findDuplicate<T extends { url: string; hash: string; text: string }>(
  candidate: { url: string; hash: string; text: string },
  existing: T[],
): { match: T; verdict: DuplicateVerdict } | null {
  let best: { match: T; verdict: DuplicateVerdict } | null = null

  for (const document of existing) {
    const verdict = compareDocuments(candidate, document)
    if (!verdict.isDuplicate) continue
    if (!best || verdict.score > best.verdict.score) best = { match: document, verdict }
  }

  return best
}
