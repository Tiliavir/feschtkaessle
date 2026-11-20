import type { Event, Item } from './models';
import { Models } from './models';

// ─── Event configuration ──────────────────────────────────────────────────────
// The shareable part of an event: its name and items, without ids or sales.
// Used by the JSON file export/import, the share link and "use as template".
interface ConfigItem {
  name: string;
  price: number;
  color: string;
}

interface EventConfig {
  name: string;
  items: ConfigItem[];
}

const DEFAULT_COLOR = '#cccccc';
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const HASH_KEY = 'cfg';

function fromEvent(event: Event): EventConfig {
  return {
    name: event.name,
    items: event.items.map((item) => ({ name: item.name, price: item.price, color: item.color })),
  };
}

function toItems(config: EventConfig): Item[] {
  return config.items.map((item) => Models.createItem(item.name, item.price, item.color));
}

function parseItem(raw: unknown): ConfigItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.name !== 'string' || item.name.trim() === '') return null;
  if (typeof item.price !== 'number' || !Number.isFinite(item.price)) return null;
  if (item.color !== undefined && (typeof item.color !== 'string' || !COLOR_PATTERN.test(item.color))) return null;
  return {
    name: item.name.trim(),
    price: Math.round(item.price * 100) / 100,
    color: typeof item.color === 'string' ? item.color : DEFAULT_COLOR,
  };
}

// Validates untrusted input (file, link). Returns null if anything is off,
// so the caller can show an error instead of importing half a config.
function parse(raw: unknown): EventConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.name !== 'string' || !Array.isArray(data.items)) return null;
  const items: ConfigItem[] = [];
  for (const rawItem of data.items) {
    const item = parseItem(rawItem);
    if (!item) return null;
    items.push(item);
  }
  return { name: data.name.trim(), items };
}

function encode(config: EventConfig): string {
  const bytes = new TextEncoder().encode(JSON.stringify(config));
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(encoded: string): EventConfig | null {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
    return parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    return null;
  }
}

function createLink(config: EventConfig, baseUri: string): string {
  return new URL(`create/#${HASH_KEY}=${encode(config)}`, baseUri).href;
}

// Reads `#cfg=…` from a location hash. undefined: no config in the hash; null: invalid config.
function fromHash(hash: string): EventConfig | null | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const encoded = params.get(HASH_KEY);
  if (encoded === null) return undefined;
  return decode(encoded);
}

export const EventConfigs = {
  fromEvent,
  toItems,
  parse,
  encode,
  decode,
  createLink,
  fromHash,
};

export type { ConfigItem, EventConfig };
