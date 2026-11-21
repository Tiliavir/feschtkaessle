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

// Parsed from the end of the line by hand: a regex for this needs backtracking.
const CURRENCIES = ['€', 'euro', 'eur', 'chf', 'fr.', 'fr'];
const PRICE_TOKEN = /^(\d{1,4})(?:[.,](\d{1,2}|-))?$/;
const NAME_TRAILING = new Set([' ', '\t', ':', '=', '.', '…', '-', '–', '—', '(', '€']);
const NAME_LEADING = new Set([' ', '\t', '-', '–', '—', '•', '*', '·']);
const MINUS = new Set(['-', '−']);
const SEPARATORS = new Set([' ', '\t', ':', '=', '(', '.', '…']);
const TRAILING_NOISE = new Set([' ', '\t', ')']);

function trimEndChars(text: string, chars: Set<string>): string {
  let end = text.length;
  while (end > 0 && chars.has(text[end - 1])) end--;
  return text.slice(0, end);
}

function trimStartChars(text: string, chars: Set<string>): string {
  let start = 0;
  while (start < text.length && chars.has(text[start])) start++;
  return text.slice(start);
}

function stripCurrency(text: string): string {
  const lower = text.toLowerCase();
  const currency = CURRENCIES.find((c) => lower.endsWith(c));
  return currency ? text.slice(0, text.length - currency.length).trimEnd() : text;
}

function isPriceChar(char: string): boolean {
  return (char >= '0' && char <= '9') || char === '.' || char === ',' || char === '-';
}

// Splits "Bier 0,5l: 4,00 €" into the head "Bier 0,5l:", sign "" and token "4,00".
// Dots right before the number are leaders ("Steak....6"); a minus glued to the number is the sign.
function splitPrice(line: string): { head: string; sign: string; token: string } | null {
  const rest = stripCurrency(trimEndChars(line, TRAILING_NOISE));
  let start = rest.length;
  while (start > 0 && isPriceChar(rest[start - 1])) start--;
  let numberStart = start;
  while (numberStart < rest.length && rest[numberStart] === '.') numberStart++;
  const hasLeaders = numberStart > start;
  let sign = '';
  let headEnd = start;
  if (MINUS.has(rest[numberStart])) {
    sign = '-';
    numberStart++;
  } else if (!hasLeaders && start > 0 && MINUS.has(rest[start - 1])) {
    sign = '-';
    headEnd = start - 1;
  }
  if (!hasLeaders && headEnd > 0 && !SEPARATORS.has(rest[headEnd - 1])) return null;
  const token = rest.slice(numberStart);
  return PRICE_TOKEN.test(token) ? { head: rest.slice(0, headEnd), sign, token } : null;
}

function parsePrice(sign: string, token: string): number {
  const [whole, fraction] = token.split(/[.,]/);
  const cents = fraction === undefined || fraction === '-' ? 0 : Number(fraction.padEnd(2, '0'));
  const value = Number(whole) + cents / 100;
  return sign === '' ? value : -value;
}

function parseLine(text: string): ConfigItem | string {
  const split = splitPrice(text);
  if (!split) return 'kein Preis am Zeilenende';
  const name = trimStartChars(trimEndChars(split.head, NAME_TRAILING), NAME_LEADING).trim();
  if (!name) return 'kein Name vor dem Preis';
  return { name, price: parsePrice(split.sign, split.token), color: '' };
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
