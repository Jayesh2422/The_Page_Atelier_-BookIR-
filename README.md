# The Page Atelier

*Thoughtfully find your next read.*

The Page Atelier is a book search and discovery website built on the **Book-Crossing** dataset
(271,379 records). It is also an Information Retrieval project: all ranking, spelling
correction, similarity and evaluation logic is implemented from scratch in TypeScript —
no database full-text search, external search API or language model produces the results.

---

## 1. Project overview

Readers can search titles, authors, publishers and (when available) descriptions; results
are ranked by TF-IDF cosine similarity, misspelled queries receive "Did you mean …?"
suggestions, every book has a details page with textually similar books, and a dashboard
measures retrieval quality with Precision@K, Recall@K and MRR.

The project covers four Information Retrieval topics:

1. **Inverted index**
2. **Vector Space Model** — TF-IDF weighting and cosine similarity
3. **Spelling correction** — edit distance with a k-gram candidate index
4. **Evaluation** — Precision@K, Recall@K, Mean Reciprocal Rank

## 2. Features

| Page | What it does |
|---|---|
| **Home** (`/`) | Editorial hero with the main search bar and example queries; sections built from real records: *Discover books* (random sample), *Explore by author* (authors with most records), *Recently added to the catalogue* (last import), *Similar books worth exploring* (the similar-book finder run on a sampled book). These showcase sections only show books whose cover image actually loads. |
| **Explore** (`/explore`) | Browse the catalogue without a query: author, publisher and year filters, sorting, server-side pagination, *Only with covers* switch. |
| **Search results** (`/search?q=…`) | Ranked or keyword mode, result count and timing, spelling suggestions, author/publisher/year filters, sorting ([§5.6](#56-sorting-options)), grid and list views, score badges, matched fields, *Only with covers* switch, pagination, loading/empty/error states. All state lives in the URL, so *Back* restores the same results. |
| **Typo-tolerant search** | "Harry Poter" → *Did you mean Harry Potter?* with alternatives and an explicit *Keep "Harry Poter"* option. |
| **Book details** (`/books/:id`) | Cover, bibliographic data, description from Google Books or Open Library with a link to the source (otherwise "Description unavailable for this edition."), subjects, other editions, similar books, *More by this author*, *Back to results*. |
| **Similar book finder** (`/books/:id/similar`) | Up to 24 textually similar books with similarity scores and explanations ("Same author", "Similar title terms: …"). |
| **Search Evaluation** (`/evaluation`) | Metric definitions, summary tiles, comparison table and charts for both retrieval modes, per-query metrics with example result lists, experimental setup and judgment notes. Computed live from the real engine. |

## 3. Technology stack

- **Frontend:** React 19, Vite 8, TypeScript 6, Tailwind CSS 4, shadcn/ui-style components (cva + Radix Slot), Lucide icons, React Router 8, DM Serif Display + DM Sans (self-hosted via Fontsource).
- **Backend:** TypeScript serverless functions in `api/` (Vercel Node.js runtime, Web-standard `Request`/`Response` handlers), shared modules in `lib/`, Zod validation.
- **Database:** MongoDB Atlas with the official MongoDB Node.js driver.
- **Metadata:** Google Books API and Open Library API (optional enrichment), Book-Crossing cover URLs.
- **Testing:** Vitest, React Testing Library, mongodb-memory-server (real `mongod` for integration tests).
- **Deployment:** Vercel (frontend + functions from one repository).

## 4. Architecture

```text
api/                     Vercel functions — thin handlers: validate → service → JSON
  search.ts  book.ts  similar.ts  discover.ts  evaluation.ts  health.ts
lib/
  ir/                    The IR engine (pure TypeScript, storage-agnostic)
    text.ts              normalisation + tokenisation (shared by index and query)
    indexer.ts           inverted-index construction (field-weighted tf, df, idf, postings)
    vsm.ts               TF-IDF formulas, query vectors, cosine similarity
    engine.ts            candidate retrieval, ranked + keyword ranking, spelling suggestions
    spelling.ts          edit distances, trigrams, candidate ranking, suggestion building
    similar.ts           similar-book retrieval and explanations
    store.ts             IndexStore interface; memory-store.ts = in-memory implementation
  db/                    MongoDB connection (cached for serverless), collections, MongoIndexStore
  indexing/build.ts      builds a new index version from the books collection
  dataset/               CSV parser, encoding repair, Book-Crossing import
  books/                 ISBN utilities, record cleaning, public Book shape
  metadata/              Google Books and Open Library clients, match validation, caching
  evaluation/            metrics and the evaluation runner
  services/              search, details/similar/discover, evaluation, health
  validation/  http/     request validation, safe error responses
scripts/                 import, enrich, build index, seed/run evaluation, judging helper, local DB
src/                     React application (pages, components, hooks, API client)
tests/server             unit + MongoDB integration tests
tests/frontend           user-flow tests (jsdom + React Testing Library)
data/evaluation/         evaluation queries and relevance judgments (JSON)
```

Request flow for a search: `api/search.ts` validates parameters → `services/search.ts` opens
the active index (`MongoIndexStore`) → `ir/engine.ts` reads the postings of the query terms
and scores candidates → the service applies filters/sorting on the top candidates with
bounded MongoDB queries → one page of books is fetched and returned. The browser never
receives more than one page (max 48 books) and never talks to MongoDB directly.

### MongoDB collections

| Collection | Contents | Indexes |
|---|---|---|
| `books` | one document per Book-Crossing record, `_id` = normalised ISBN; Book-Crossing fields, normalised keys (`titleSort`, `authorKey`, `publisherKey`, `dedupKey`), optional `google` / `openLibrary` metadata and their `enrichment` / `openLibraryEnrichment` state | `_id` (unique ISBN), `titleSort`, `authorKey+titleSort`, `publisherKey+titleSort`, `year`, `importedAt`, `dedupKey`, `isbn13`, `enrichment.status`, `openLibraryEnrichment.status` |
| `vocabulary` | `{v, term, df, idf, cf, len, grams}` per index version | `v + grams` (multikey, for spelling candidates); `_id = version:term` for lookups |
| `postings` | impact-ordered postings `{d, tf, w, m}` in chunks of 2,000 | `v + term + chunk` |
| `docVectors` | top 60 terms of each book's unit TF-IDF vector (for similar books) | `v`; `_id = version:bookId` |
| `indexMeta` | `{_id: "active"}` → active version, N, field weights, top authors/publishers | `_id` |
| `evaluationQueries` | evaluation queries + relevance judgments | `dataset + order` |
| `googleBooksCache` | raw Google Books responses keyed by request | `_id` |
| `openLibraryCache` | raw Open Library responses keyed by path (404s included) | `_id` |

Index data is **versioned**: a rebuild writes a new version next to the old one, flips
`indexMeta.active` with one write, then deletes the old version. Searches never see a
half-built index, and an interrupted build is cleaned up by the next run.

## 5. Information Retrieval concepts

### 5.1 Text normalisation and tokenisation (`lib/ir/text.ts`)

The same pipeline is used for documents and queries:

1. decode HTML entities found in the dataset (`&amp;` → `&`);
2. Unicode NFKD normalisation and removal of combining marks (`Márquez` → `marquez`);
3. lower-casing;
4. removal of possessive `'s` and other apostrophes (`Sorcerer's` → `sorcerer`, `O'Brien` → `obrien`);
5. splitting on every character that is not a Unicode letter or digit;
6. dropping single letters (initials), tokens longer than 40 characters and stop words.

**Stop-word policy:** a deliberately small list of 22 English function words (`a, an, and,
are, as, at, be, by, for, from, in, is, of, on, or, that, the, this, to, was, were, with`).
Words such as "it" are kept (Stephen King's *It*). **No stemming**: in a catalogue of short
titles and names, stemming conflates surnames and title words ("Banks" → "bank").

**Field boundaries:** each field is tokenised separately; tokens are counted per field and
combined with field weights (below). A posting stores a bit mask of the fields that contain
the term (title 1, author 2, publisher 4, description 8, categories 16), used to show
"matched in title/author" and to explain similarity.

### 5.2 Inverted index (`lib/ir/indexer.ts`, `lib/indexing/build.ts`)

For each term *t* the index stores the document frequency *df(t)*, the smoothed *idf(t)*,
the collection frequency and a postings list. Each posting holds the book id, the
field-weighted term frequency *tf_w(t,d)*, the normalised TF-IDF weight *ŵ(t,d)* and the
field mask. Postings are sorted by weight (descending), i.e. an **impact-ordered index**:
query processing reads at most 20,000 postings per term (a *champion list*). Only terms
appearing in more than 20,000 books are affected, and their idf is already low.

Measured on the full dataset (local MongoDB 8.2): **271,016 books, 118,125 terms,
2,415,063 postings** (116,548 terms and 2,345,215 postings before enrichment added
descriptions and subjects), built in about 30–65 seconds.

### 5.3 Vector Space Model (`lib/ir/vsm.ts`)

| Quantity | Formula |
|---|---|
| Field-weighted tf | tf_w(t,d) = Σ_f weight(f) · count(t in field f of d) |
| Sub-linear tf | tfw(t,d) = log₂(1 + tf_w(t,d)) — equals 1 for one unweighted occurrence |
| Smoothed idf | idf(t) = ln((1 + N) / (1 + df(t))) + 1 — always ≥ 1 and finite |
| Document weight | w(t,d) = tfw(t,d) · idf(t), then L2-normalised: ŵ(t,d) = w(t,d) / ‖d‖ |
| Query weight | w(t,q) = log₂(1 + tf(t,q)) · idf(t) |
| Cosine similarity | cos(q,d) = Σ_t w(t,q) · ŵ(t,d) / ‖q‖ |

**Field weights** (`lib/ir/config.ts`): title 3, author 2.5, publisher 0.75, categories 0.3,
description 0.1. Changing them requires `npm run build:index`.

Why descriptions are weighted so low: a description adds many terms to a book's vector, and
the cosine normalisation then shrinks the weight of its title terms, so enriched books sank
below short un-enriched editions. Measured on the evaluation set after enriching 633 books:

| Description / categories weight | Ranked P@10 | R@10 | MRR |
|---|---|---|---|
| 1 / 1.5 | 0.650 | 0.098 | 0.725 |
| 0.3 / 0.5 | 0.750 | 0.157 | 0.841 |
| **0.1 / 0.3 (used)** | 0.831 | 0.191 | 0.938 |
| 0 / 0 | 0.863 | 0.192 | 1.000 |

The judgments are based on titles and authors, so this test set cannot reward matches found
through descriptions; weight 0 is favoured by construction. 0.1 / 0.3 keeps descriptions
searchable while restoring most of the title-based quality. Pivoted length normalisation
(IIR §6.4.4) is the principled alternative.

Because document vectors are normalised at index time, the query-time score is a sparse dot
product accumulated *term-at-a-time* from the postings, divided by ‖q‖. **Unseen query
terms** have no postings: they are left out of the query vector and of ‖q‖ and reported to
the user (and to the spelling corrector). A query made only of stop words returns no
results with an explanatory notice. Scores lie in [0, 1]. **Ties** are broken by the number
of matched terms and then by book id, so rankings are deterministic.

*Meaning and limitations of the score:* it measures how similar the distribution of query
terms is to the book's weighted terms. It does not know about popularity, quality, edition
or reading level, prefers short records in which the query terms make up most of the text,
and treats each word independently (no phrases or synonyms).

### 5.4 Spelling correction (`lib/ir/spelling.ts`, `lib/ir/engine.ts`)

1. **Vocabulary:** every term of the inverted index with its df, so corrections always exist in the catalogue.
2. **Which terms are corrected:** terms with df = 0, and very rare terms (df ≤ 2) when a neighbour is at least 20× more frequent. Terms shorter than 4 characters and numbers are never corrected.
3. **Candidates — k-gram index:** each vocabulary term is stored with its padded character trigrams (`poter` → `$po pot ote ter er$`). Candidates must share at least |G(q)| − 4k trigrams with the query term (*k* = allowed edits); one edit changes at most 3 trigrams and a transposition at most 4, so this filter never discards a valid correction. MongoDB evaluates this with a multikey index and `$setIntersection`.
4. **Verification — edit distance:** Damerau–Levenshtein (optimal string alignment: insert, delete, substitute, adjacent transposition, each cost 1). Thresholds: length 4–5 → ≤ 1 edit, length ≥ 6 → ≤ 2 edits.
5. **Ranking:** smaller distance first; among equal distances, **context-sensitive** re-ranking by how many books contain the candidate together with the other query terms (IIR §3.3.5); then df.
6. **Suggestions:** up to three whole-query suggestions; the user's original words and capitalisation are preserved. The user must click a suggestion to search for it, or can keep the original query.

Examples measured on the full catalogue: *Harry Poter* → Harry Potter · *tolkein hobbit* →
tolkien hobbit · *Lord of the Rigns* → Lord of the Rings · *shakespere hamlet* → shakespeare
hamlet · *hary potter* → harry potter.

### 5.5 Similar books (`lib/ir/similar.ts`)

The source book's stored unit vector (its 25 strongest terms) is used as the query against
the same inverted index; sim(s,d) = Σ ŵ(t,s) · ŵ(t,d). Other editions of the same work
(same normalised title + author) are excluded and listed separately, and results are
de-duplicated by work. Explanations group shared terms by a field that contains the term in
both books. Books without descriptions still work through title, author and publisher
terms. Similarity is **textual only** — it does not predict whether a reader will like a book.

### 5.6 Sorting options

**Relevance** (default) means "best match first", and its criterion depends on the mode:

- **Ranked:** the TF-IDF cosine score (the *Score* badge, 0–1). A book scores higher when the
  query words appear in heavily weighted fields (title ×3, author ×2.5, publisher ×0.75,
  categories ×0.3, description ×0.1), when they are rare in the catalogue (idf), and when they
  make up a large share of the book's text (cosine normalisation). Ties: more matched query
  words first, then book id.
- **Keyword:** the number of distinct query words the book contains (the *Matched n/m* badge);
  books with the same count stay in catalogue-id order.

The other options only reorder the matching books (for very broad queries, the best 5,000):

| Option | Criterion |
|---|---|
| Title (A–Z) | normalised title (case, accents and punctuation ignored), then id |
| Author (A–Z) | normalised author name, then title |
| Newest first | publication year descending; books without a year come last |
| Oldest first | publication year ascending; books without a year (about 4,600) currently come **first** — see limitations |

### 5.7 Covers and the "Only with covers" switch

Whether a cover exists can only be known by loading it: almost every record has an Amazon URL,
but many of those return a 1×1 placeholder. The browser therefore tries each cover URL in turn
(§8) and records books for which none works in a session-wide registry
(`src/hooks/useMissingCovers.ts`). The homepage sections use it to show only books with a working
cover (the discovery API sends extra candidates so sections stay full). In Search and Explore,
*Only with covers* (`covers=only` in the URL) hides such books on the current page and says how
many were hidden. It is a display option only: ranking, result counts and the evaluation are
unaffected, and the API never receives it.

## 6. Dataset source and setup

The Page Atelier uses **`BX-Books.csv`** from the Book-Crossing dataset (Cai-Nicolas Ziegler,
2004; ~271k books). `BX-Users.csv` and `BX-Book-Ratings.csv` are not needed.

- Original page (now often offline): <http://www2.informatik.uni-freiburg.de/~cziegler/BX/>
- Mirrors: Kaggle ("Book-Crossing dataset" / "Book Recommendation Dataset") and several GitHub mirrors, e.g. `ashwanidv100/Recommendation-System---Book-Crossing-Dataset` (`BX-CSV-Dump/BX-Books.csv`).

Place the file at `data/raw/BX-Books.csv` (git-ignored) or pass `--file`. Both the original
`;`-separated dump and the `,`-separated Kaggle `Books.csv` are supported.

The original file is mostly UTF-8 with known damage, which the importer repairs and reports:
doubly-encoded characters whose second byte became `?` (7,487 repaired), characters where
both bytes were lost (591 — best guess "ß" inside a word, "Ü" at a word start, counted
separately), stray Windows-1252 bytes (154), HTML entities, and backslash-escaped quotes.

## 7. MongoDB Atlas setup

1. Create a cluster at <https://cloud.mongodb.com>.
2. *Database Access* → add a database user with read/write access.
3. *Network Access* → allow your IP for local scripts, and `0.0.0.0/0` (or Vercel's egress IPs on paid plans) for Vercel functions.
4. *Connect → Drivers* → copy the `mongodb+srv://…` connection string into `MONGODB_URI`.
5. Run `npm run db:setup` to create indexes and print the status.

**Storage sizing (measured):** the full catalogue with its index uses about 457 MB of data
plus 127 MB of indexes (books 181 MB, postings 134 MB, document vectors 119 MB, vocabulary
23 MB), and a rebuild temporarily holds two index versions. That exceeds the **512 MB M0
free tier**. On M0 import a subset, e.g. `npm run import:books -- --limit 100000`; use a
Flex/M10 cluster for the complete dataset.

**Local alternative:** `npm run db:local` starts a persistent local MongoDB (via
mongodb-memory-server) at `mongodb://127.0.0.1:27027/`, storing data in `data/local-db`.

## 8. Book metadata: Google Books and Open Library

Enrichment is optional. Search and ranking never call an external service; they use what the
enrichment scripts (or enrich-on-view) stored in MongoDB.

### Google Books API configuration

1. Google Cloud Console → enable **Books API** → *Credentials* → create an API key (restrict it to the Books API).
2. Set `GOOGLE_BOOKS_API_KEY` in `.env` (and in Vercel if `ENRICH_ON_VIEW` is used).

Without a key the client falls back to unauthenticated requests, which share a small
global quota and are frequently refused with HTTP 429 (this happened during development).

**Matching rules:** ISBN search first; a volume is accepted only if its industry identifiers
contain the record's ISBN-10/13. Otherwise a plain-text search for the title words and the
author's surname. During development Google's `isbn:`/`intitle:`/`inauthor:` operators
intermittently returned no results at all, so the client stops using `isbn:` for the rest of
a run after eight empty answers. A plain-text result whose identifiers contain the record's
ISBN is accepted as an ISBN-confirmed match; otherwise a volume is accepted only if the
title token Jaccard similarity (parentheticals removed) is ≥ 0.6 **and** the record's author
surname appears in the volume's authors. Unvalidated results are stored as `rejected` and
never attached, and a stored match is never downgraded by a later failed attempt.
Book-Crossing fields stay primary; Google Books fills description, categories, page count,
published date, language, link and an additional cover. Metadata is stored under `google`
with `matchedBy`, `confidence`, `volumeId` and `fetchedAt`, so provenance is visible (the UI
labels Google descriptions).

**Quota:** a key comes with a limited daily request quota and each book needs one or two
requests, so the whole catalogue cannot be enriched at once. Spend it on books people see:
`--priority` (below) and `ENRICH_ON_VIEW=true` (a book is looked up the first time someone
opens it; the page waits at most 3 s, and failed lookups are retried on up to 3 views).

### Open Library (second metadata source)

Open Library needs no key and has no daily quota, so it fills gaps that Google Books cannot.
`GET openlibrary.org/isbn/<isbn>.json` returns the edition with exactly that ISBN (pages,
publish date, cover ids, link to its *work*); the work holds the description and subjects
shared by all editions. The edition is identified by ISBN, so it is the same book by
construction; as a guard against bad data its title must still share a word with the
Book-Crossing title, otherwise the result is `rejected`. Descriptions are cleaned of Markdown
links and "Also contained in" notes, and machine tags are removed from subjects. Requests send
a `User-Agent`, run at about one book per second, and every response (including 404s) is cached
in `openLibraryCache`. State and data are stored separately from Google's
(`openLibraryEnrichment`, `openLibrary`).

**Merge rules:** Book-Crossing fields first; then Google Books; Open Library only fills what
is still missing (description, subjects as categories, page count, publish date). The UI says
which source a description came from and links to it.

**Covers:** each book lists cover URLs in priority order: Book-Crossing (Amazon), Google Books,
Open Library by cover id, Open Library by ISBN (`…/b/isbn/<isbn>-L.jpg?default=false`, which
answers 404 when there is no cover; ISBN lookups are rate-limited per visitor). The browser tries
them in order and shows a typographic placeholder when none exists.

## 9. Environment variables

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | yes | MongoDB connection string (server-side only). |
| `MONGODB_DATABASE` | no | Database name, default `page_atelier`. |
| `GOOGLE_BOOKS_API_KEY` | no | Google Books API key for enrichment. |
| `ENRICH_ON_VIEW` | no | `true` (recommended) lets the details API look up a book on first view; the page waits at most 3 s and the result is cached. Off when unset. |

Copy `.env.example` to `.env`. None of these variables are exposed to the browser bundle
(Vite only exposes `VITE_`-prefixed variables, and the client never reads environment variables).

## 10. Local development

Requirements: Node.js 22 or 24, npm.

```bash
npm install
cp .env.example .env            # set MONGODB_URI (or use npm run db:local)
npm run import:books -- --limit 50000
npm run build:index
npm run seed:evaluation
npm run dev                     # http://localhost:5173 — frontend + /api functions
```

`npm run dev` serves the `api/*.ts` functions through a small Vite plugin
(`vite.config.ts`) that calls the same exported `GET` handlers Vercel calls, so no Vercel
CLI is needed. `vercel dev` also works if you prefer the Vercel runtime locally.

| Script | Purpose |
|---|---|
| `npm run dev` / `build` / `preview` | Vite development server / production build / preview of the built frontend |
| `npm run typecheck` / `lint` / `test` | TypeScript (server + client), ESLint, Vitest |
| `npm run check` | all of the above plus the production build |
| `npm run import:books` | import Book-Crossing records |
| `npm run enrich:books` | Google Books enrichment batch |
| `npm run build:index` | build/refresh the inverted index |
| `npm run seed:evaluation` / `evaluate` | load judgments into MongoDB / print evaluation results |
| `npm run judge -- --query "…"` | pooled result list to help prepare judgments |
| `npm run db:setup` / `db:local` | create indexes and print status / start a local MongoDB |

## 11. Importing the dataset

```bash
npm run import:books -- --dry-run                       # parse and report only
npm run import:books -- --file data/raw/BX-Books.csv    # all records
npm run import:books -- --limit 100000 --batch-size 1000
```

The importer parses the real encoding and quoting, cleans records (whitespace, entities,
years 0 or in the future → unknown, HTTPS cover URLs), rejects rows without ISBN or title,
keeps records without author, normalises ISBNs (validating ISBN-10/13 checksums and deriving
ISBN-13), skips duplicate ISBNs, upserts in batches by `_id` and reports *inserted / updated /
unchanged / skipped / rejected* plus "possible duplicate editions". Re-running is safe and
never overwrites Google Books data. Result on the full file: 271,379 rows → 271,016 records,
363 duplicate ISBNs skipped, 0 rejected (1 min 50 s against a local MongoDB).

Cover URLs: the original `images.amazon.com` host now answers 403; the same paths work on
`images-na.ssl-images-amazon.com`, so the importer rewrites only the host (and forces HTTPS).

## 12. Enriching book metadata

```bash
npm run enrich:books -- --priority --limit 1000 --delay 400   # Google Books: books users actually see first
npm run enrich:books -- --source openlibrary --priority --limit 2000   # Open Library (no quota, ~1 book/s)
npm run enrich:books -- --limit 500 --delay 300               # never-attempted records, by ISBN
npm run enrich:books -- --retry-errors --retry-not-found      # also retry failed / not-found records
npm run build:index                                            # make descriptions/categories searchable
```

`--priority` takes the top 40 ranked results of each evaluation query and example query (the
first result of every query, then the second, …), so a limited quota covers the books most
likely to be displayed. Run it daily until the quota allows broader batches.

The script processes one record at a time with a delay (default 250 ms for Google Books,
700 ms for Open Library), caches every response (`googleBooksCache`, `openLibraryCache`),
backs off exponentially on HTTP 429/5xx/timeouts and stops after four consecutive failures.
It reports matched / not found / rejected / errors. It runs separately from the import and from
web requests. With `ENRICH_ON_VIEW=true`, opening a book that was never looked up queries both
sources in parallel (the page waits at most 3 s).

## 13. Building and refreshing the inverted index

```bash
npm run build:index
```

Run it after every import or enrichment batch, or after changing field weights. It reads all
books, builds the index in memory (the full dataset fitted within Node's default heap during development), writes a new
version in batches and switches over atomically. Searches keep using the previous version
until the new one is complete. Run it on a developer machine or CI job, not in a Vercel
function (it exceeds serverless time limits on large catalogues).

## 14. Testing

```bash
npm test          # 11 server suites + 1 frontend suite (151 tests)
npm run check     # typecheck + lint + tests + production build
```

- **IR unit tests:** tokenisation, index construction and df counts, TF-IDF formulas, cosine similarity (including a brute-force comparison), ranking order and tie-breaking, empty and unseen-term queries, edit distances, thresholds, the lossless trigram filter, suggestions, similar books, Precision@K, Recall@K, MRR, the evaluation runner and the judgments file.
- **Backend:** CSV parsing, encoding repair, ISBN validation, record cleaning, Google Books and Open Library matching, text cleaning and HTTP error handling (mocked), enrich-on-view retry rules, cover URL order, parameter validation and safe error responses.
- **Integration (real MongoDB via mongodb-memory-server):** import → index → every API handler — search, filters, pagination limits, sorting, browse, details, 404/400, similar books, discover, evaluation, health, Google Books and Open Library enrichment (storage, caching, merge order, never downgrading a match, searchable descriptions), missing index, missing configuration, unreachable database.
- **Frontend flows:** searching, empty-query validation, example queries, opening a book and returning to the same results, accepting or keeping a spelling suggestion, filters, mode switching, the *Only with covers* switch, cover-only homepage sections, similar books, empty, not-found, setup and retryable error states.

The suite was checked by deliberately breaking the cosine normalisation: two ranking tests
failed with the defect and all passed again once it was removed.

The first test run downloads a MongoDB binary (~100 MB) for the integration suite.

## 15. Evaluation methodology

**Setup.** 16 queries (`data/evaluation/queries.json`) are run against the current index in
both modes. Both modes rank the **same candidate set** (all books containing at least one
query term), so differences come only from the ranking function:

- **Keyword baseline:** books ordered by the number of distinct query terms they contain; ties stay in catalogue-id order (effectively unranked within a level).
- **Ranked:** TF-IDF cosine similarity as described above.

**Metrics.** Precision@K = |relevant ∩ top K| / K; Recall@K = |relevant ∩ top K| / |relevant|;
RR = 1 / rank of the first relevant book within the top 100 (0 if none); MRR = mean RR.
Precision@K divides by K even if fewer results are returned. K can be changed on the dashboard.

**Relevance judgments — how they were made.** They were prepared manually for this project,
not by independent assessors, and are **not objective ground truth**. For each query an
information need and explicit inclusion criteria were written first (stored in each query's
`notes`), applied to the titles and authors of the full catalogue, and the matching records
were reviewed by hand to remove off-topic books (e.g. Monty Python for "python programming",
*Java Man* for "learning java", World War III novels for "world war ii"). Limitations: the
criteria use title and author metadata, so relevant books whose titles do not mention the
topic are missed (judgments are incomplete, which understates recall), relevance is binary,
and the same metadata is what both systems index. If only part of the dataset is imported,
judged books that are absent are excluded from the recall denominator, and queries without
any imported relevant book are skipped and reported.

To extend or review the judgments: `npm run judge -- --query "dog training"` prints the
pooled top-20 of both modes with already-judged books marked; edit the JSON, then
`npm run seed:evaluation`. Results are recomputed on every dashboard load or via
`npm run evaluate -- --k 10`.

**Measured results** (full catalogue, 1,345 books enriched by Google Books and/or Open Library,
K = 10, 22 Oct 2026):

| Mode | P@10 | R@10 | MRR@100 |
|---|---|---|---|
| Keyword baseline | 0.750 | 0.185 | 0.844 |
| Ranked TF-IDF | 0.844 | 0.196 | 0.927 |

Ranked retrieval scored higher P@10 on 9 queries, the baseline on 3 ("agatha christie
mystery", "sherlock holmes", "python programming"), and 4 tied. Before any enrichment (no
descriptions) the figures were 0.738 / 0.163 / 0.906 for the baseline and 0.856 / 0.188 /
1.000 for ranked retrieval; see §5.3 for why enrichment lowers the title-based scores
slightly. With 16 queries and incomplete judgments, these are indications on this test set,
not statistically established improvements.

## 16. Vercel deployment

1. Push the repository to GitHub.
2. Vercel → *Add New Project* → import the repository. `vercel.json` sets the Vite framework preset, `npm ci`, `npm run build`, output `dist`.
3. *Settings → Environment Variables:* add `MONGODB_URI` and `MONGODB_DATABASE` (and optionally `GOOGLE_BOOKS_API_KEY`, `ENRICH_ON_VIEW`) for Production and Preview.
4. In Atlas *Network Access*, allow connections from Vercel (`0.0.0.0/0` on shared plans).
5. Import data and build the index **from your machine** against the same database (`npm run import:books`, `npm run build:index`, `npm run seed:evaluation`). Deploy.
6. Check `https://<your-app>.vercel.app/api/health` → `{"status":"ok","database":"connected","index":"ready"}`.

How routing works: files in `api/` become Node.js functions (each exports `GET(request:
Request): Response`). The rewrite `/((?!api/).*) → /index.html` sends every other path to the
SPA, so refreshing `/books/…` or `/search?q=…` works; static assets are served first.
`engines.node` selects Node 22/24. The package is an ES module, so server-side imports use
explicit `.js` extensions; this was verified by compiling `api/` and `lib/` with `tsc` and
running the handlers in plain Node. Function `maxDuration` is 30 s; typical searches take
50–450 ms against a local database.

**Not verified:** an actual deployment to Vercel and a connection to a real Atlas cluster
were not performed during development (no credentials were available). The functions were
tested against a local MongoDB 8.2 through the Vite dev server and in plain Node.

**Troubleshooting**

| Symptom | Fix |
|---|---|
| `/api/health` → `database: not_configured` | `MONGODB_URI` missing in the Vercel environment (redeploy after adding it). |
| `database: unavailable` | Atlas network access list, wrong password or URI. |
| `INDEX_NOT_BUILT` | Run `npm run build:index` against the same `MONGODB_DATABASE`. |
| 404 on page refresh | `vercel.json` rewrites missing or modified. |
| Atlas "space quota exceeded" | Import fewer books (`--limit`) or use a larger tier. |
| Enrichment returns only errors | HTTP 429 — add `GOOGLE_BOOKS_API_KEY` or lower the batch size. |
| Google Books matches almost nothing | Its `isbn:`/`intitle:` operators sometimes return empty results; the client falls back to plain-text search automatically. Retry with `--retry-not-found`. |
| Dev server shows "Cannot read properties of null (reading 'useContext')" | Vite's pre-bundled dependency cache is stale (two copies of React). Stop the server, delete `node_modules/.vite` (or run `npx vite --force`) and hard-refresh the browser. |

## 17. Limitations and future improvements

- Book-Crossing metadata is sparse (title, author, year, publisher); without enrichment there are no descriptions or categories, so topical queries ("mystery novels") match title words only.
- About 100 records keep characters that could not be recovered from the encoding damage; 591 were repaired with a documented best guess.
- Many records are different editions of the same work; search results list editions separately (details pages group them).
- Facets are computed from the 300 best-ranked results; filters/sorting operate on the best 5,000 candidates (flagged in the response).
- The index is rebuilt in full; incremental updates, stemming as an option, phrase/proximity scoring, BM25 as a third evaluated mode, and a larger, independently judged query set would be natural next steps.
- Covers come from Amazon, Google and Open Library URLs that may disappear; 6 of 144 result cards (about 4%) still showed the typographic placeholder across six sample searches.
- Descriptions exist only for enriched books: so far 1,345 of 271,016 records were enriched (Google Books 1,013, Open Library 1,058) and 1,070 have a description, chosen to cover the most-searched books (95 of 144 cards in the six sample searches show one). The rest fill in through further batches and enrich-on-view.
- "Oldest first" puts books without a publication year first (MongoDB sorts missing values lowest); "Newest first" correctly puts them last.
- The *Only with covers* switch filters the loaded page in the browser, so a page can show fewer than 24 books.
---

*Data: Book-Crossing dataset © Cai-Nicolas Ziegler et al. (2004), used for research and
education. Book metadata and covers via Google Books and Open Library where indicated; cover
images belong to their publishers.*
