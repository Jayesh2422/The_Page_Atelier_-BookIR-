/**
 * Byte-level decoding for the Book-Crossing dump.
 *
 * The file is mostly UTF-8, but contains two kinds of damage:
 *  1. Doubly-encoded characters whose second byte was lost: "ü" (UTF-8 C3 BC) was encoded
 *     again as C3 83 C2 BC and the 0x83 byte was replaced by "?" (0x3F), giving C3 3F C2 BC.
 *     Both C3 3F C2 xx and C3 83 C2 xx are repaired to the original two bytes C3 xx.
 *     When the second original byte was lost as well (C3 3F C2 3F) the character cannot be
 *     recovered exactly. In this German-heavy subset it is almost always "ß" inside a word
 *     ("groÃ?Â?e" → "große") and "Ü" at the start of a word ("Ã?Â?bersetzung" → "Übersetzung"),
 *     so that best-effort guess is applied and counted separately as an ambiguous repair.
 *  2. Stray single bytes ≥ 0x80 that are not part of valid UTF-8. These are decoded as
 *     Windows-1252 / Latin-1, which matches how the remaining legacy rows were written.
 */

const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

function isContinuation(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0x80 && byte <= 0xbf;
}

/** Length of a valid UTF-8 sequence starting at `i`, or 0 if the bytes are not valid UTF-8. */
function utf8SequenceLength(bytes: Uint8Array, i: number): number {
  const b0 = bytes[i]!;
  if (b0 >= 0xc2 && b0 <= 0xdf) return isContinuation(bytes[i + 1]) ? 2 : 0;
  if (b0 >= 0xe0 && b0 <= 0xef) return isContinuation(bytes[i + 1]) && isContinuation(bytes[i + 2]) ? 3 : 0;
  if (b0 >= 0xf0 && b0 <= 0xf4) {
    return isContinuation(bytes[i + 1]) && isContinuation(bytes[i + 2]) && isContinuation(bytes[i + 3]) ? 4 : 0;
  }
  return 0;
}

export interface DecodeStats {
  repairedDoubleEncoded: number;
  ambiguousRepairs: number;
  legacyBytes: number;
}

export function decodeBookCrossing(bytes: Uint8Array, stats: DecodeStats = { repairedDoubleEncoded: 0, ambiguousRepairs: 0, legacyBytes: 0 }): string {
  const decoder = new TextDecoder('utf-8');
  const parts: string[] = [];
  let runStart = 0;
  const flush = (end: number) => {
    if (end > runStart) parts.push(decoder.decode(bytes.subarray(runStart, end)));
  };

  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b < 0x80) {
      i++;
      continue;
    }
    // Damage type 1b: C3 3F C2 3F — both original bytes lost.
    if (b === 0xc3 && bytes[i + 1] === 0x3f && bytes[i + 2] === 0xc2 && bytes[i + 3] === 0x3f) {
      flush(i);
      const previous = (parts.at(-1) ?? '').slice(-1);
      parts.push(/\p{L}/u.test(previous) ? 'ß' : 'Ü');
      stats.ambiguousRepairs++;
      i += 4;
      runStart = i;
      continue;
    }
    // Damage type 1: C3 (3F|83) C2 xx  →  C3 xx
    if (b === 0xc3 && (bytes[i + 1] === 0x3f || bytes[i + 1] === 0x83) && bytes[i + 2] === 0xc2 && isContinuation(bytes[i + 3])) {
      flush(i);
      parts.push(decoder.decode(Uint8Array.of(0xc3, bytes[i + 3]!)));
      stats.repairedDoubleEncoded++;
      i += 4;
      runStart = i;
      continue;
    }
    const length = utf8SequenceLength(bytes, i);
    if (length > 0) {
      i += length;
      continue;
    }
    // Damage type 2: a lone legacy byte.
    flush(i);
    parts.push(String.fromCharCode(CP1252_HIGH[b] ?? b));
    stats.legacyBytes++;
    i++;
    runStart = i;
  }
  flush(bytes.length);
  const text = parts.join('');
  // Drop a leading byte-order mark (U+FEFF).
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
