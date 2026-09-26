# Mobility Tax Intelligence

A mobile-first app that tracks tax, payroll, social security and treaty developments affecting employees who work across borders — explains each one in plain language, shows its sources, tests your understanding, and connects it to a synthetic client workforce.

**Educational and informational only. Not professional tax, legal or immigration advice.**

---

## What it is and who it is for

Global Mobility Services professionals help multinational companies manage tax for employees working outside their home country, and for domestic employees travelling state to state. Regulatory change is constant and scattered across dozens of authorities.

| User | What they get |
|---|---|
| **Student / early-career GMS** (primary) | A feed of real developments explained without assuming prior tax knowledge, plus lessons and vocabulary built from them |
| **Tax or mobility professional** | A concise, source-linked feed with a Professional Mode summary per item |
| **Interviewer** | A working demonstration of source-grounded AI use, with an [evaluation page](#the-evaluation-set) showing how well it actually works |

The front end is deliberately plain. The sophistication is behind it: collecting from multiple sources, deduplicating, classifying relevance, extracting structured facts with verbatim evidence, and turning current events into short learning activities.

---

## Quick start

Requires **Node.js 20.9+** (developed on 24.21). No database to install, no accounts, no API key.

```bash
npm install
npm run db:migrate      # create the schema
npm run db:seed         # load demonstration content
npm run dev             # http://localhost:3000
```

That gives you the whole app running on seeded demonstration data, at zero cost. Live collection ([below](#live-collection)) needs an API key; nothing else does.

> **Stop `npm run dev` before running any `db:*` or `collect` command.** Local development uses PGlite, which is single-process — a running dev server holds the database open and a script's writes will not be visible to it (and may not land at all). This constraint disappears in production, where Neon is a real networked server.

### If the local database breaks

Hard-killing the dev server (`Stop-Process -Force`, `kill -9`) can corrupt the PGlite data directory; you will see `RuntimeError: Aborted()` from the WASM layer on the next query. The data is entirely reproducible:

```bash
npm run db:fix          # reset + migrate + seed
```

---

## Information flow, from source to published update

```
  ┌─ every hour, GitHub Actions → POST /api/refresh ─────────────────────┐
  │                                                                       │
  │  1  FETCH FEED           conditional GET with stored ETag             │
  │     └─ 304 Not Modified → stop. costs nothing. ← the cost model       │
  │                                                                       │
  │  2  KNOWN URL?           already stored → skip            (free)      │
  │  3  FETCH ARTICLE        HTML → text, or GOV.UK JSON API              │
  │  4  CONTENT HASH         byte-identical repost → skip      (free)     │
  │  5  NEAR-DUPLICATE?      shingle similarity → attach as               │
  │                          corroborating source on the existing         │
  │                          development, raising verification (free)     │
  │  6  KEYWORD GATE         no tax/employment vocabulary → skip (free)   │
  │                                                                       │
  │  7  RELEVANCE SCREEN     Haiku 4.5    ~$0.0025    ← first cost        │
  │     └─ not relevant → stop                                            │
  │                                                                       │
  │  8  EXTRACT + WRITE      Opus 5       ~$0.10                          │
  │     structured facts w/ quotes · both summaries · impact analysis      │
  │     · 5-stage lesson with questions                                   │
  │                                                                       │
  │  9  VERIFY EVERY QUOTE   is it a real substring of the stored text?   │
  │     └─ fails → that fact is stored as NULL, not unsupported           │
  │                                                                       │
  │ 10  VALIDATE             evidence rule · verification ceiling ·       │
  │                          question validity                            │
  │     └─ any failure → review_state 'needs_review' (kept, not shown)    │
  │                                                                       │
  │ 11  PUBLISH              review_state 'approved' → appears in feed    │
  │     then: link vocabulary terms, recompute assignment matches         │
  └───────────────────────────────────────────────────────────────────────┘
```

Three free gates run before any spend. That ordering is the cost model: a repost or an irrelevant press release never reaches a model.

---

## Where AI is used, and where it is not

This split is the point of the project, so it is worth stating precisely.

### AI does

| Task | Model | Why a model |
|---|---|---|
| Relevance screening | Haiku 4.5 | Judging whether a document concerns mobile employees needs reading comprehension |
| Extracting structured facts + evidence quotes | Opus 5 | Finding the sentence that states an effective date is a language task |
| Plain-language and professional summaries | Opus 5 | Writing |
| Impact analysis (employee / employer / GMS) | Opus 5 | Reasoning about implications, hedged |
| Lesson prose and questions | Opus 5 | Writing, and judging what is genuinely uncertain |

### Deterministic code does

| Task | Where | Why not a model |
|---|---|---|
| **Quote verification** | `pipeline/ai.ts` → `verifyQuotes` | A model cannot be trusted to audit its own citations |
| Duplicate detection | `pipeline/dedupe.ts` | Text similarity is solved; a model would cost money per comparison and give different answers on different days |
| Keyword prefilter | `pipeline/prefilter.ts` | Free, and it only decides what deserves a model's attention |
| Verification level | `db/invariants.ts` → `checkVerificationCeiling` | Derived from source tier by rule |
| Question validity | `db/invariants.ts` → `checkQuestionValidity` | A structural check, not a judgement |
| Assignment matching | `app/lib/matching.ts` | Set intersection and date comparison — and it must explain itself |
| Spaced repetition | `app/lib/spaced-repetition.ts` | Arithmetic over dates |
| All counts, filters, sorting, dashboard figures | SQL | |

Per the brief: *"Use deterministic code for dates, counts, filters, calculations, and status tracking. Use AI primarily for classification, extraction, translation, explanations, and drafting."*

---

## The provenance model

Two requirements rule out how AI content apps are normally built:

> Do not silently fill missing dates, jurisdictions, legal status, or affected populations.
> AI-generated interpretation must be visibly distinguishable from source facts.

So instead of one summary blob per item:

**1. Every extracted fact is nullable, and NULL means "the source did not state this."** Never "we didn't get to it." The UI renders it as an explicit *"Not stated in this source"* with a note on why the absence matters — a rule with no announced effective date is a finding, not a gap.

**2. Every fact column `x` has a sibling `xEvidenceId`** pointing at an `evidence_spans` row: a verbatim quote with character offsets into a document we fetched and stored. Enforced at write time as `x IS NOT NULL ⇒ xEvidenceId IS NOT NULL`. **No claim without a quote.**

**3. Facts and opinions live in different tables.** `developments` holds only source facts. `interpretations` holds every AI-written word. The UI cannot confuse them because they are not in the same place, and every interpretation block is individually labelled — not once per page, where it would scroll away and stop applying.

**4. Newspapers cannot confirm a rule.** Verification level is capped by the best source tier backing a development; a press-only item can never wear a confirmed badge.

**5. A quiz cannot manufacture certainty.** Every correct answer must cite a verified quote *or* be flagged "not enough information to decide" — which is frequently the best answer available. A lesson with any unsupported answer is withheld entirely.

**6. Synthetic assignment data only.** `isSynthetic` defaults true with no code path setting it false; employee references must match an opaque `EMP-0042` shape. No salary figures are stored anywhere, deliberately — storing one would invite the app to compute an answer it has no business computing.

---

## Data model

28 tables. Full annotated definitions in [`db/schema.ts`](db/schema.ts).

```
sources ──────────< raw_documents ──────< evidence_spans
   │                      │                     ▲ ▲ ▲
jurisdictions             │                     │ │ │  (every fact points here)
                          │                     │ │ │
                 development_sources            │ │ │
                          │                     │ │ │
                          ▼                     │ │ │
   ┌────────────────  developments  ────────────┘ │ │
   │                   (FACTS ONLY)               │ │
   │                        │                     │ │
   │   ┌────────────────────┼─────────────────┐   │ │
   │   ▼                    ▼                 ▼   │ │
   │ development_          interpretations   lessons
   │  jurisdictions         (OPINIONS)        │   │ │
   │  _topics                    │            ├─ lesson_stages
   │  _populations               └─ interpretation_evidence
   │  _terms ──> vocab_terms      │           └─ lesson_questions
   │                              │                └─ lesson_options ─┘
   ▼
development_assignment_matches >── assignments ──< assignment_deadlines

ops: processing_runs · corrections · eval_samples · eval_runs
user: saved_items · question_attempts · term_review_state
```

Key points: `raw_documents` and `evidence_spans` are append-only (the record of what a claim was based on must survive). `developments` has no `summary` column — that would be an opinion. Every join table carries its own `evidence_id`, so "why is Ireland attached to this?" has an answer.

---

## Adding a source or a jurisdiction

Both are **rows, not code**. Adding Germany does not require a refactor.

### A new jurisdiction

```sql
INSERT INTO jurisdictions (code, name, kind, parent_code, enabled)
VALUES ('DE', 'Germany', 'country', NULL, true);
```

Use an ISO country code, or `US-XX` for a US state. **Tag the jurisdiction a development actually applies to — never its parent.** The matcher treats a parent as covering all children, so tagging `US` on a New York measure makes it match every US assignment. (This is not hypothetical; it happened, and a New York proposal matched 9 of 10 assignments.)

### A new source

Add a row to `SOURCES` in [`db/seed-sources.ts`](db/seed-sources.ts), then `npm run db:seed:sources` (idempotent — it preserves live polling state on existing rows).

```ts
{
  name: 'Bundeszentralamt für Steuern',
  publisher: 'German Federal Central Tax Office',
  jurisdictionCode: 'DE',
  tier: 'primary_official',        // gates the maximum verification level
  feedKind: 'rss',                 // rss | atom | govuk_content_api | json | html_scrape
  feedUrl: 'https://...',
  articleLinkPattern: '/news/',    // html_scrape only: path regex for article links
  notes: 'Why this source, and what to watch for.',
}
```

**Probe the URL before trusting it:**

```bash
npm run probe:feeds     # reports status, conditional-request support, item counts
```

This matters more than it sounds. The first version of the source list guessed every URL from how each site "should" be organised, and most were wrong: the IRS publishes no RSS feed at all, Irish Revenue's advertised XML path serves HTML, and the CRA's own department filter returns zero entries. Add your candidate to `scripts/probe-feeds.ts` and check.

A new `feedKind` needs one parser in [`pipeline/sources.ts`](pipeline/sources.ts). Nothing else changes.

---

## Testing and evaluation

```bash
npm run verify:all      # everything: 177 assertions across 7 suites
```

| Suite | What it covers | Needs |
|---|---|---|
| `verify:pipeline` | Quote verification, prefilter, dedupe, cost maths | nothing |
| `verify:eval` | The evaluation scorer itself | nothing |
| `verify:matching` | Assignment matching, jurisdiction hierarchy | nothing |
| `verify:lesson` | All 5 lesson stages in a real browser | dev server |
| `verify:vocab` | Browse, term card, save/difficulty independence, practice, review | dev server |
| `verify:assignments` | Assignment screens, match explanations, state scoping | dev server |
| `verify:dashboard` | Dashboard honesty (null vs 0%, disclosed multi-counting) | dev server |
| `eval` | Extraction accuracy against 6 reviewed samples | **API key** |

The first three need no network, no database and no API key, and run in milliseconds.

### The evaluation set

Six documents with hand-verified answers ([`db/seed-evals.ts`](db/seed-evals.ts)). Rerun after any prompt or model change and compare:

```bash
npm run eval
```

Scoring is deliberately **asymmetric**, because three outcomes are not equally bad:

| Expected | Got | Verdict | Fails the sample? |
|---|---|---|---|
| `null` | `null` | **correct abstention** — the behaviour the product depends on | no |
| `null` | a value | **FABRICATION** — invented a fact the source lacks | **yes** |
| a value | `null` | **missed** — degrades to "not stated in source": unhelpful, not untrue | no |
| a value | wrong value | **wrong** | **yes** |

Averaging those into one accuracy percentage would let fabrications hide. Five of the 36 expected fields are `null` — those are the most valuable rows, because extracting a date that is present is easy and declining to invent one that is absent is the thing most likely to regress silently.

Results are also visible in the app at **`/evaluation`**, alongside live measurements of source backing, declined guesses, question validity and collection health.

---

## Live collection

**This is the only part that costs money.** Everything above runs on seeded data for free.

### 1. Get an API key and set a spend cap

Sign up at [console.anthropic.com](https://console.anthropic.com), create a key, and **set a monthly spend limit first** (Billing → Limits). Suggested: $25.

```bash
cp .env.example .env.local   # add ANTHROPIC_API_KEY
```

### 2. Try it without spending anything

```bash
npm run collect:dry     # fetch, parse, deduplicate. No AI calls, no cost.
```

This exercises the riskiest half — HTTP, feed parsing, conditional requests, deduplication — for free.

### 3. Run it for real

```bash
npm run collect:one     # one article, one source. Costs roughly $0.10.
npm run collect         # 5 per source, 25 per run ceiling
```

### 4. Schedule it hourly

Deploy, then set two GitHub Actions secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
|---|---|
| `COLLECT_URL` | `https://your-app.vercel.app/api/refresh` |
| `COLLECT_SECRET` | any random string; set the same value in your host's environment |

[`.github/workflows/collect.yml`](.github/workflows/collect.yml) then fires hourly. Until those secrets exist it exits cleanly with a message rather than failing — a red cross on every hourly run trains you to ignore it.

### What it costs, and why hourly ≈ daily

Cost tracks **how many new articles appear**, not how often you look. Every fetch sends back the stored `ETag`; an unchanged feed answers `304 Not Modified` with no body, and no AI runs.

| Stage | Volume | Rate | Per day |
|---|---|---|---|
| Relevance screen | ~40 items | Haiku 4.5, $1/$5 per MTok | ~$0.10 |
| Extract + write | ~8 items | Opus 5, $5/$25 per MTok | ~$0.80 |

≈ **$25/month**. Hosting is free (Vercel Hobby + Neon free tier + GitHub Actions).

---

## Known limitations

**The AI stages have never been executed.** No API key was available during development. They are schema-validated, typechecked, and their guardrails are unit tested — but unproven against the real API. This is the largest single gap in the project and the honest headline.

**California is not covered.** The Franchise Tax Board returns `403 Forbidden` to every request. Deliberately not worked around: the brief says to respect access restrictions, and disguising the client is not a technical problem to solve. The source row is kept, disabled and documented.

**Canada's feed is all-department.** The CRA's own department filter returns zero entries, so the feed covers all Government of Canada news releases and the relevance screen rejects the rest. Noisier, but a filter that silently returns nothing looks like "no news" forever.

**Two sources have no conditional-request support.** Irish Revenue and New York send no `ETag` or `Last-Modified`, so their index pages are re-fetched and re-parsed every run. Parsing is free and only new URLs proceed, so this costs nothing but bandwidth.

**HTML scrapers will break.** Three of five sources have no feed. Each is failure-isolated and records `consecutive_failures`, so a break is visible on `/evaluation` rather than silent — but it will need fixing when a site is redesigned.

**Single user.** No accounts. `user_id` exists as a column defaulting to `'local'`, so multi-user is a migration rather than a rewrite.

**No translation yet.** The schema supports it (`raw_documents.translated_text`, with the original retained) and the brief asks for it, but all five live sources publish in English so nothing exercises the path. Adding a non-English jurisdiction is what would make it real.

**The keyword prefilter can produce false negatives.** A genuinely relevant document written in unusual language could be dropped with no AI call. The bar is deliberately low (one tax-specific term, or three generic ones) and rejections are counted per run. If the eval set ever shows it dropping something real, remove it — the cents it saves matter less than relevance accuracy.

---

## Future improvements

- Run the eval set and tune the extraction prompt against measured fabrication rate
- A review queue UI for `needs_review` items (the state exists; nothing surfaces it yet)
- User corrections to summaries, dates and classifications (the `corrections` table exists and is unused)
- Notifications — selective, per the brief: a new relevant development, a saved jurisdiction changing, an approaching deadline, a weekly briefing
- A non-English jurisdiction, to exercise translation
- More jurisdictions, chosen by probing feeds rather than by interest
- Written-answer lesson questions

---

## Demonstration path

A five-minute route through the app that shows the thinking rather than the feature list.

**1. Open `/updates`.** Point out the status badges — *Proposed*, *Passed into law*, *In effect now* are three different colours because conflating them is the mistake the product exists to avoid. Note the item reading *"? Status not stated"*.

**2. Open "US guidance addresses counting workdays".** Scroll to **Takes effect**. It says *"— Not stated in this source"* with an explanation. Say why: the document has a publication date and no effective date, and using one for the other is the single most common way a summary quietly becomes untrue.

**3. Tap "Show the source"** under any fact. The verbatim quote appears with a link to the document. Every fact on the page can do this, because a fact whose quote fails verification is stored as null instead.

**4. Scroll to the interpretation blocks.** Every one is tagged *Interpretation* — per block, not once per page. The *What is still unknown* block is amber. Expand *"What this is based on"* to see the quotes the reasoning rests on.

**5. Toggle Professional Mode.** Same facts, different register and ordering.

**6. Take the lesson** (`/learn` → the US item). At stage 2 the Next button is disabled until every question is answered. Answer question 1 wrong on purpose. **Question 2's correct answer is "Not enough information — the source does not state an effective date."** At stage 3 it says: *"There is no quote to show, because the source does not address this. That absence is the answer."*

> This is the thing to dwell on. A model asked to write a quiz will invent a confident answer. Ten of the twelve questions cite a verbatim quote; two cannot, and are flagged as unanswerable. A lesson with any unsupported answer is withheld entirely.

**7. Scroll to "synthetic assignments may need review"** on the update. Each match explains itself — which jurisdiction matched, in which role, whether the assignment spans the effective date — and appends *"Still unknown: the source states no effective date, so it is not known whether this assignment falls within scope."*

**8. Open `/evaluation`.** Percentage of facts backed by a source quote, how many facts the app declined to guess at, question validity, collection health, and the six-sample eval set with what each one tests. Note honestly that the eval has not been run — no API key.

**9. If asked what went wrong:** the New York proposal was tagged with both `US-NY` and `US`, so it matched 9 of 10 assignments; stripping `<form>` elements destroyed an entire source because Irish Revenue runs ASP.NET; and a 400-character minimum excluded genuine Irish eBriefs because a short document is not a bad one. All three were caught by tests or by reading output, and all three are in the commit history with the reasoning.

---

## Commands

| | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `start` | Production |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run verify:all` | Every test suite |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Seed everything |
| `npm run db:generate` | Regenerate a migration after editing `db/schema.ts` |
| `npm run db:reset` / `db:fix` | Delete the local database / reset + migrate + seed |
| `npm run db:studio` | Browse the database |
| `npm run db:match` | Recompute assignment matches |
| `npm run collect:dry` | Collection dry run — free |
| `npm run collect` | Live collection — **costs money** |
| `npm run eval` | Score extraction against the sample set — **costs money** |
| `npm run probe:feeds` | Check what candidate feed URLs actually serve |
| `npm run screenshot` | Phone-sized screenshots, light and dark |
| `npm run icons` | Regenerate the PWA icon set |

---

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind 4 · Drizzle ORM · PGlite locally / Neon in production · Zod · Anthropic SDK · Playwright · `sharp`

Local development uses **PGlite** — Postgres compiled to WebAssembly, running from a folder — so it speaks the same SQL dialect as production with no install and no account. That is what makes everything except live collection free to run.
