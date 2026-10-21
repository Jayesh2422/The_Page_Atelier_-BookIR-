import { describe, expect, it } from 'vitest';
import { isbn10To13, isbnVariants, isValidIsbn10, isValidIsbn13, normalizeIsbn } from '../../lib/books/isbn.js';
import { cleanRecord, dedupKeyFor, parseYear, toPublicBook, upgradeCoverUrl, type RawBookRecord } from '../../lib/books/model.js';
import { detectDelimiter, parseCsv } from '../../lib/dataset/csv.js';
import { decodeBookCrossing } from '../../lib/dataset/encoding.js';
import { parseBookCrossing } from '../../lib/dataset/import.js';

const HEADER = '"ISBN";"Book-Title";"Book-Author";"Year-Of-Publication";"Publisher";"Image-URL-S";"Image-URL-M";"Image-URL-L"';
const row = (...fields: string[]) => fields.map((f) => `"${f}"`).join(';');

describe('CSV parsing', () => {
  it('parses quoted fields, doubled quotes, backslash escapes and embedded newlines', () => {
    const text = 'a;b;c\n"x;1";"say ""hi""";"Steinbeck \\"Essentials\\""\r\n"multi\nline";;plain\n';
    expect([...parseCsv(text, { delimiter: ';' })]).toEqual([
      ['a', 'b', 'c'],
      ['x;1', 'say "hi"', 'Steinbeck "Essentials"'],
      ['multi\nline', '', 'plain'],
    ]);
  });

  it('handles a backslash-escaped quote right before the closing quote', () => {
    expect([...parseCsv('"Three Novels: \\"Freedom Song\\"";"next"', { delimiter: ';' })]).toEqual([['Three Novels: "Freedom Song"', 'next']]);
  });

  it('detects the delimiter from the header', () => {
    expect(detectDelimiter(HEADER)).toBe(';');
    expect(detectDelimiter('"ISBN","Book-Title","Book-Author"')).toBe(',');
  });
});

describe('encoding repair', () => {
  it('keeps valid UTF-8 and repairs doubly-encoded characters', () => {
    const bytes = Uint8Array.from([0x4c, 0xc3, 0x3f, 0xc2, 0xbc, 0x62, 0x62, 0x65, 0x20, 0xc3, 0xa9]);
    expect(decodeBookCrossing(bytes)).toBe('Lübbe é');
  });

  it('applies the documented best guess when both bytes were lost', () => {
    const word = Uint8Array.from([0x67, 0x72, 0x6f, 0xc3, 0x3f, 0xc2, 0x3f, 0x65]);
    const start = Uint8Array.from([0xc3, 0x3f, 0xc2, 0x3f, 0x62, 0x65, 0x72]);
    expect(decodeBookCrossing(word)).toBe('große');
    expect(decodeBookCrossing(start)).toBe('Über');
  });

  it('decodes stray legacy bytes as Windows-1252 and strips a BOM', () => {
    const stats = { repairedDoubleEncoded: 0, ambiguousRepairs: 0, legacyBytes: 0 };
    expect(decodeBookCrossing(Uint8Array.from([0xef, 0xbb, 0xbf, 0x93, 0x41, 0x94, 0xe9]), stats)).toBe('“A”é');
    expect(stats.legacyBytes).toBe(3);
  });
});

describe('ISBN handling', () => {
  it('normalises and validates ISBN-10 and ISBN-13', () => {
    expect(normalizeIsbn('0-439-13959-7')).toBe('0439139597');
    expect(normalizeIsbn('080652121x')).toBe('080652121X');
    expect(isValidIsbn10('0439139597')).toBe(true);
    expect(isValidIsbn10('0439139598')).toBe(false);
    expect(isValidIsbn10('080652121X')).toBe(true);
    expect(isValidIsbn13('9780439139595')).toBe(true);
    expect(isbn10To13('0439139597')).toBe('9780439139595');
    expect(isbnVariants('0439139597')).toEqual(['0439139597', '9780439139595']);
    expect(isbnVariants('12345')).toEqual([]);
  });
});

describe('record cleaning', () => {
  const raw = (overrides: Partial<RawBookRecord> = {}): RawBookRecord => ({
    ISBN: '0439139597',
    'Book-Title': 'Harry Potter and the Goblet of Fire (Book 4)',
    'Book-Author': 'J. K. Rowling',
    'Year-Of-Publication': '2000',
    Publisher: 'Scholastic &amp; Co',
    'Image-URL-S': 'http://images.amazon.com/images/P/0439139597.01.THUMBZZZ.jpg',
    'Image-URL-M': 'http://images.amazon.com/images/P/0439139597.01.MZZZZZZZ.jpg',
    'Image-URL-L': 'not a url',
    ...overrides,
  });

  it('cleans a valid record', () => {
    const result = cleanRecord(raw());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.book).toMatchObject({
      _id: '0439139597',
      isbn13: '9780439139595',
      isbnValid: true,
      year: 2000,
      publisher: 'Scholastic & Co',
      authorKey: 'j k rowling',
      dedupKey: 'harry potter and the goblet of fire|j k rowling',
    });
    expect(result.book.covers.medium).toBe('https://images-na.ssl-images-amazon.com/images/P/0439139597.01.MZZZZZZZ.jpg');
    expect(result.book.covers.large).toBeNull();
  });

  it('rejects records without ISBN or title and keeps records without author', () => {
    expect(cleanRecord(raw({ ISBN: '---' }))).toEqual({ ok: false, reason: 'missing-isbn' });
    expect(cleanRecord(raw({ 'Book-Title': '   ' }))).toEqual({ ok: false, reason: 'missing-title' });
    const noAuthor = cleanRecord(raw({ 'Book-Author': '' }));
    expect(noAuthor.ok && noAuthor.book.author).toBeNull();
  });

  it('treats impossible years as unknown', () => {
    expect(parseYear('0')).toBeNull();
    expect(parseYear('2050', 2026)).toBeNull();
    expect(parseYear('1999')).toBe(1999);
    expect(parseYear('DK Publishing')).toBeNull();
  });

  it('rewrites only http(s) cover URLs', () => {
    expect(upgradeCoverUrl('javascript:alert(1)')).toBeNull();
    expect(upgradeCoverUrl('http://example.org/x.jpg')).toBe('https://example.org/x.jpg');
  });

  it('groups editions of the same work', () => {
    expect(dedupKeyFor('The Hobbit (Illustrated Edition)', 'J.R.R. Tolkien')).toBe(dedupKeyFor('The Hobbit', 'J.R.R. Tolkien'));
  });

  it('converts to the public shape without inventing missing fields', () => {
    const result = cleanRecord(raw());
    if (!result.ok) throw new Error('expected ok');
    const book = toPublicBook({ ...result.book, google: null, enrichment: null });
    expect(book.description).toBeNull();
    expect(book.categories).toEqual([]);
    expect(book.covers).toEqual([
      'https://images-na.ssl-images-amazon.com/images/P/0439139597.01.MZZZZZZZ.jpg',
      'https://covers.openlibrary.org/b/isbn/0439139597-L.jpg?default=false',
    ]);
  });
});

describe('file import parsing', () => {
  it('parses, validates and de-duplicates a Book-Crossing file', () => {
    const text = [
      HEADER,
      row('0439139597', 'Harry Potter', 'J. K. Rowling', '2000', 'Scholastic', '', '', ''),
      row('0-439-13959-7', 'Duplicate after normalisation', 'X', '2000', 'Y', '', '', ''),
      row('', 'No ISBN', 'X', '2000', 'Y', '', '', ''),
      row('0195153448', 'Classical Mythology', 'Mark P. O. Morford', '2002', 'Oxford University Press', '', '', ''),
      '"1234";"too";"few"',
      row('0439136350', 'Harry Potter', 'J. K. Rowling', '1999', 'Scholastic', '', '', ''),
    ].join('\n');
    const { records, report } = parseBookCrossing(new TextEncoder().encode(text));
    expect(records.map((r) => r._id)).toEqual(['0439139597', '0195153448', '0439136350']);
    expect(report).toMatchObject({ rowsRead: 6, accepted: 3, skippedDuplicates: 1, rejected: { 'missing-isbn': 1, 'malformed-row': 1 }, possibleDuplicateEditions: 2, delimiter: ';' });
  });

  it('respects the record limit', () => {
    const text = [HEADER, row('0439139597', 'A', 'B', '2000', 'C', '', '', ''), row('0195153448', 'D', 'E', '2001', 'F', '', '', '')].join('\n');
    expect(parseBookCrossing(new TextEncoder().encode(text), 1).records).toHaveLength(1);
  });

  it('rejects files with an unexpected header', () => {
    expect(() => parseBookCrossing(new TextEncoder().encode('a;b;c\n1;2;3'))).toThrow(/Unexpected CSV header/);
  });
});
