/**
 * Text normalisation and tokenisation shared by indexing and querying.
 *
 * Every string that enters the inverted index — and every query — goes through
 * `tokenize`, so a term produced at index time is byte-for-byte identical to the
 * term produced for the same word at query time.
 *
 * Pipeline:
 *   1. Decode the few HTML entities that appear in the Book-Crossing CSV (&amp;, &#39; …).
 *   2. Unicode NFKD normalisation, then strip combining marks  ("Márquez" → "Marquez").
 *   3. Lower-case.
 *   4. Drop possessive "'s" and remaining apostrophes          ("Sorcerer's" → "sorcerer",
 *                                                              "O'Brien" → "obrien").
 *   5. Split on any character that is not a Unicode letter or digit
 *      (hyphens, punctuation, slashes, whitespace…).
 *   6. Discard single letters (initials such as the "J" in "J. K. Rowling"),
 *      over-long tokens and stop words.
 *
 * No stemming is applied: stemming conflates author surnames and title words
 * ("Banks" → "bank"), which hurts a catalogue made mostly of short fields.
 */

/**
 * Stop-word policy: a deliberately small list of English function words that occur in a
 * large share of titles and carry no topical meaning. Content words, pronouns such as
 * "it" (a Stephen King title) and non-English words are kept.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'of',
  'on', 'or', 'that', 'the', 'this', 'to', 'was', 'were', 'with',
]);

export const MAX_TOKEN_LENGTH = 40;

const ENTITY_MAP: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
};

/** Decode named and numeric HTML entities (the BX dump contains "&amp;" and "&#39;"). */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return ENTITY_MAP[body.toLowerCase()] ?? match;
  });
}

/** Steps 1–4: a normalised, lower-case string with diacritics and apostrophes removed. */
export function normalizeText(input: string): string {
  return decodeEntities(input)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/'s\b/g, '')
    .replace(/'/g, '');
}

/** Split normalised text into raw word tokens (before stop-word removal). */
export function splitWords(normalized: string): string[] {
  return normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export function isIndexableToken(token: string): boolean {
  if (token.length > MAX_TOKEN_LENGTH) return false;
  if (token.length === 1 && !/\p{N}/u.test(token)) return false;
  return !STOP_WORDS.has(token);
}

/** Full pipeline used for both documents and queries. Order and duplicates are preserved. */
export function tokenize(input: string | null | undefined): string[] {
  if (!input) return [];
  return splitWords(normalizeText(input)).filter(isIndexableToken);
}

/**
 * A normalised key for exact-match filtering and grouping (author, publisher, edition
 * de-duplication). Unlike `tokenize`, it keeps every word, including stop words and initials.
 */
export function normalizeKey(input: string | null | undefined): string {
  if (!input) return '';
  return splitWords(normalizeText(input)).join(' ');
}

/** Count term occurrences in a token list. */
export function termFrequencies(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}
