import type { Event, Item, Transaction } from './models';
import { Models } from './models';
import type { AppState } from './storage';

// ─── Sales export and merge ───────────────────────────────────────────────────
// Several people sell at the same fest, each on their own device. Each device
// exports its sales; one device imports the others to see the evening's total.
const EXPORT_TYPE = 'kassierer-sales';
const EXPORT_VERSION = 1;

interface SalesExport {
  type: typeof EXPORT_TYPE;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  event: { id: string; name: string; createdAt: string };
  // All items the transactions refer to (own and previously imported).
  items: Item[];
  // Device id → name, for every device with transactions in this export.
  devices: Record<string, string>;
  transactions: Transaction[];
}

interface MergeResult {
  event: Event;
  added: number;
  skipped: number;
}

function deviceLabel(state: AppState, event: Event, deviceId: string): string {
  if (deviceId === state.deviceId) return state.deviceName || 'Dieses Gerät';
  return event.devices[deviceId] || `Gerät ${deviceId.slice(0, 4)}`;
}

function buildExport(state: AppState, event: Event): SalesExport {
  const devices: Record<string, string> = {};
  for (const tx of event.transactions) {
    devices[tx.deviceId] = deviceLabel(state, event, tx.deviceId);
  }
  return {
    type: EXPORT_TYPE,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    event: { id: event.id, name: event.name, createdAt: event.createdAt },
    items: [...event.items, ...event.importedItems],
    devices,
    transactions: event.transactions,
  };
}

// ─── Validation (untrusted file) ──────────────────────────────────────────────
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isItem(value: unknown): value is Item {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isFiniteNumber(value.price) &&
    typeof value.color === 'string'
  );
}

function isTxLine(value: unknown): value is { itemId: string; quantity: number } {
  return isRecord(value) && typeof value.itemId === 'string' && Number.isInteger(value.quantity);
}

function isTransaction(value: unknown): value is Transaction {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.deviceId === 'string' &&
    typeof value.timestamp === 'string' &&
    !Number.isNaN(Date.parse(value.timestamp)) &&
    Array.isArray(value.items) &&
    value.items.every(isTxLine) &&
    isFiniteNumber(value.total) &&
    isFiniteNumber(value.received) &&
    isFiniteNumber(value.change)
  );
}

function isDevices(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((name) => typeof name === 'string');
}

function parseExport(raw: unknown): SalesExport | null {
  if (!isRecord(raw) || raw.type !== EXPORT_TYPE || raw.version !== EXPORT_VERSION) return null;
  const event = raw.event;
  if (!isRecord(event) || typeof event.id !== 'string' || typeof event.name !== 'string') return null;
  if (!Array.isArray(raw.items) || !raw.items.every(isItem)) return null;
  if (!Array.isArray(raw.transactions) || !raw.transactions.every(isTransaction)) return null;
  if (!isDevices(raw.devices)) return null;
  const itemIds = new Set(raw.items.map((item) => item.id));
  const known = raw.transactions.every((tx) => tx.items.every((line) => itemIds.has(line.itemId)));
  return known ? (raw as unknown as SalesExport) : null;
}

// ─── Merge ────────────────────────────────────────────────────────────────────
function itemKey(item: Item): string {
  return `${item.name.trim().toLowerCase()}|${item.price}`;
}

// Items are created per device (new ids from the share link), so they are matched by
// name and price. Unmatched items are kept as importedItems for the statistics.
function mapItems(event: Event, foreign: Item[]): { idMap: Record<string, string>; importedItems: Item[] } {
  const known: Record<string, string> = {};
  for (const item of [...event.items, ...event.importedItems]) {
    known[item.id] = item.id;
    known[itemKey(item)] ??= item.id;
  }
  const idMap: Record<string, string> = {};
  const importedItems = event.importedItems.slice();
  for (const item of foreign) {
    const match = known[item.id] ?? known[itemKey(item)];
    if (match) {
      idMap[item.id] = match;
      continue;
    }
    importedItems.push(item);
    known[item.id] = item.id;
    known[itemKey(item)] = item.id;
    idMap[item.id] = item.id;
  }
  return { idMap, importedItems };
}

function merge(state: AppState, event: Event, data: SalesExport): MergeResult {
  const existing = new Set(event.transactions.map((tx) => tx.id));
  const fresh = data.transactions.filter((tx) => !existing.has(tx.id));
  const { idMap, importedItems } = mapItems(event, data.items);
  const transactions = fresh.map((tx) => ({
    ...tx,
    items: tx.items.map((line) => ({ itemId: idMap[line.itemId], quantity: line.quantity })),
  }));
  const devices = { ...event.devices };
  for (const [deviceId, name] of Object.entries(data.devices)) {
    if (deviceId !== state.deviceId && !devices[deviceId]) devices[deviceId] = name;
  }
  const merged: Event = {
    ...event,
    importedItems,
    devices,
    transactions: [...event.transactions, ...transactions].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
  };
  return { event: merged, added: transactions.length, skipped: data.transactions.length - transactions.length };
}

// ─── CSV (for the treasurer's spreadsheet) ────────────────────────────────────
// Semicolon and decimal comma: what German Excel/LibreOffice open without asking.
// Text starting with = + @ would run as a formula in the spreadsheet, so it is prefixed with '.
function csvCell(value: string | number): string {
  const text = typeof value === 'number' ? value.toFixed(2).replace('.', ',') : value.replace(/^[=+@]/, "'$&");
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(';');
}

function buildCsv(state: AppState, event: Event): string {
  const itemsMap = Models.buildItemsMap([...event.items, ...event.importedItems]);
  const sold = Models.calculateItemsSold(event);
  const totals = Models.calculateEventTotals(event);
  const rows = [
    csvRow(['Veranstaltung', event.name]),
    csvRow(['Datum', event.createdAt.slice(0, 10)]),
    '',
    csvRow(['Artikel', 'Preis', 'Anzahl', 'Umsatz']),
    ...Object.entries(sold)
      .sort(([, a], [, b]) => b.quantity - a.quantity)
      .map(([itemId, info]) => csvRow([info.name, itemsMap[itemId].price, String(info.quantity), info.revenue])),
    '',
    csvRow(['Gerät', 'Transaktionen', 'Umsatz']),
    ...Models.calculateDeviceTotals(event).map((d) =>
      csvRow([deviceLabel(state, event, d.deviceId), String(d.transactionCount), d.revenue]),
    ),
    '',
    csvRow(['Summe', String(totals.transactionCount), totals.revenue]),
  ];
  return `${rows.join('\r\n')}\r\n`;
}

function fileBaseName(event: Event): string {
  return `${event.name.replace(/[^a-z0-9äöüß]/gi, '_')}_${event.createdAt.slice(0, 10)}`;
}

export const Sales = {
  buildExport,
  parseExport,
  merge,
  buildCsv,
  deviceLabel,
  fileBaseName,
};

export type { MergeResult, SalesExport };
