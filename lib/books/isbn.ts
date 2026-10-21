/** ISBN normalisation and validation. */

/** Upper-case and strip everything except digits and X ("0-439-13959-7" → "0439139597"). */
export function normalizeIsbn(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^0-9X]/g, '');
}

export function isValidIsbn10(isbn: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = isbn[i]!;
    sum += (ch === 'X' ? 10 : Number(ch)) * (10 - i);
  }
  return sum % 11 === 0;
}

export function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

export function isbn10To13(isbn10: string): string | null {
  if (!isValidIsbn10(isbn10)) return null;
  const core = `978${isbn10.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  return core + String((10 - (sum % 10)) % 10);
}

export function isValidIsbn(isbn: string): boolean {
  return isValidIsbn10(isbn) || isValidIsbn13(isbn);
}

/** Every valid ISBN-10/13 form of an identifier, used to verify external matches. */
export function isbnVariants(isbn: string): string[] {
  const variants = new Set<string>();
  if (isValidIsbn10(isbn)) {
    variants.add(isbn);
    const thirteen = isbn10To13(isbn);
    if (thirteen) variants.add(thirteen);
  } else if (isValidIsbn13(isbn)) {
    variants.add(isbn);
  }
  return [...variants];
}
