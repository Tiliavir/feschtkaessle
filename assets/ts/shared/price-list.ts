import type { ConfigItem } from './config';

// ─── Price list parser ────────────────────────────────────────────────────────
// Turns pasted text (typed, or returned by an AI app from a photo) into items:
// one item per line, the last number in the line is the price.
interface RejectedLine {
  line: number;
  text: string;
  reason: string;
}

interface PriceListResult {
  items: ConfigItem[];
  rejected: RejectedLine[];
}

const PALETTE = [
  '#e67e22',
  '#3498db',
  '#27ae60',
  '#9b59b6',
  '#f1c40f',
  '#e74c3c',
  '#1abc9c',
  '#795548',
  '#85c1e9',
  '#f48fb1',
  '#95a5a6',
  '#d35400',
];

// Optional sign glued to the number ("-2", not "Wurst - 3,50"), euros, optional cents or ",-".
const PRICE_PATTERN = /(^|[\s:=(.…])([-−]?)(\d{1,4})(?:[.,](\d{1,2}|-))?\s*(?:€|eur|euro|chf|fr\.?)?\s*\)?\s*$/i;
const NAME_TRAILER = /[\s:=.…\-–—(€]+$/;
const NAME_LEADER = /^[\s\-–—•*·]+/;

function parsePrice(sign: string, whole: string, fraction: string | undefined): number {
  const cents = fraction === undefined || fraction === '-' ? 0 : Number(fraction.padEnd(2, '0'));
  const value = Number(whole) + cents / 100;
  return sign === '' ? value : -value;
}

function parseLine(text: string): ConfigItem | string {
  const match = PRICE_PATTERN.exec(text);
  if (!match) return 'kein Preis am Zeilenende';
  const name = text
    .slice(0, match.index + match[1].length)
    .replace(NAME_TRAILER, '')
    .replace(NAME_LEADER, '')
    .trim();
  if (!name) return 'kein Name vor dem Preis';
  return { name, price: parsePrice(match[2], match[3], match[4]), color: '' };
}

function parse(text: string): PriceListResult {
  const items: ConfigItem[] = [];
  const rejected: RejectedLine[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const result = parseLine(line);
    if (typeof result === 'string') {
      rejected.push({ line: index + 1, text: line, reason: result });
      return;
    }
    items.push({ ...result, color: PALETTE[items.length % PALETTE.length] });
  });
  return { items, rejected };
}

export const PriceList = {
  parse,
};

export type { PriceListResult, RejectedLine };
