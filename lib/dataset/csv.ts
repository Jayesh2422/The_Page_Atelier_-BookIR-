/**
 * A small RFC 4180-style CSV parser with the extensions needed for Book-Crossing files:
 *  - configurable delimiter (the original BX-Books.csv uses ";", the Kaggle copy uses ","),
 *  - quoted fields with doubled quotes ("") and backslash-escaped quotes (\"),
 *  - newlines inside quoted fields, CRLF or LF line endings.
 */

export interface CsvOptions {
  delimiter?: string;
  /** Treat \" inside a quoted field as a literal quote (Book-Crossing convention). */
  backslashEscapes?: boolean;
}

export function* parseCsv(text: string, options: CsvOptions = {}): Generator<string[]> {
  const delimiter = options.delimiter ?? ',';
  const backslash = options.backslashEscapes ?? true;
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let fieldStarted = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i]!;
    if (inQuotes) {
      if (backslash && ch === '\\' && text[i + 1] === '"') {
        field += '"';
        i += 2;
      } else if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      i++;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
      fieldStarted = false;
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(field);
      if (!(row.length === 1 && row[0] === '')) yield row;
      row = [];
      field = '';
      fieldStarted = false;
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      fieldStarted = true;
      i++;
    }
  }
  if (fieldStarted || field !== '' || row.length > 0) {
    row.push(field);
    yield row;
  }
}

/** Guess the delimiter from the header line. */
export function detectDelimiter(headerLine: string): string {
  const counts = [';', ',', '\t'].map((d) => [d, headerLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ',';
}
