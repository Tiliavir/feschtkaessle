import type { Event, Item, Transaction } from './models';
import { Models } from './models';

const STORAGE_KEY = 'kassierer_app_v1';

// ─── State interface ──────────────────────────────────────────────────
interface AppState {
  events: Event[];
  activeEventId: string | null;
  // Identifies this device's sales when several devices' sales are merged.
  deviceId: string;
  deviceName: string;
}

// ─── Default state ───────────────────────────────────────────────────
function defaultState(): AppState {
  return {
    events: [],
    activeEventId: null,
    deviceId: Models.generateId(),
    deviceName: '',
  };
}

// ─── Migration ────────────────────────────────────────────────────────
// Older data lacks device and transaction ids. Fill them in once and save, so ids
// stay stable: exported sales are deduplicated by transaction id.
function migrateEvent(event: Event, deviceId: string): { event: Event; changed: boolean } {
  let changed = !Array.isArray(event.importedItems) || !event.devices || typeof event.devices !== 'object';
  const transactions = event.transactions.map((tx) => {
    if (tx.id && tx.deviceId) return tx;
    changed = true;
    return { ...tx, id: tx.id || Models.generateId(), deviceId: tx.deviceId || deviceId };
  });
  if (!changed) return { event, changed };
  return {
    event: {
      ...event,
      transactions,
      importedItems: Array.isArray(event.importedItems) ? event.importedItems : [],
      devices: event.devices && typeof event.devices === 'object' ? event.devices : {},
    },
    changed,
  };
}

function migrate(parsed: AppState): { state: AppState; changed: boolean } {
  let changed = typeof parsed.deviceId !== 'string' || typeof parsed.deviceName !== 'string';
  const deviceId = typeof parsed.deviceId === 'string' ? parsed.deviceId : Models.generateId();
  const events = parsed.events.map((event) => {
    const result = migrateEvent(event, deviceId);
    changed = changed || result.changed;
    return result.event;
  });
  const state: AppState = {
    events,
    activeEventId: parsed.activeEventId ?? null,
    deviceId,
    deviceName: typeof parsed.deviceName === 'string' ? parsed.deviceName : '',
  };
  return { state, changed };
}

// ─── Load / Save ──────────────────────────────────────────────────────
function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as AppState;
    // Basic integrity check
    if (!parsed || !Array.isArray(parsed.events)) return defaultState();
    const { state, changed } = migrate(parsed);
    if (changed) saveState(state);
    return state;
  } catch {
    return defaultState();
  }
}

function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

// ─── Event operations ─────────────────────────────────────────────────
function addEvent(state: AppState, event: Event): AppState {
  const newState: AppState = { ...state };
  newState.events = [...state.events, event];
  newState.activeEventId = event.id;
  saveState(newState);
  return newState;
}

function setActiveEvent(state: AppState, eventId: string): AppState {
  const newState: AppState = { ...state, activeEventId: eventId };
  saveState(newState);
  return newState;
}

function getActiveEvent(state: AppState): Event | null {
  if (!state.activeEventId) return null;
  return state.events.find((e) => e.id === state.activeEventId) || null;
}

function updateEvent(state: AppState, updatedEvent: Event): AppState {
  const newState: AppState = { ...state };
  newState.events = state.events.map((e) => (e.id === updatedEvent.id ? updatedEvent : e));
  saveState(newState);
  return newState;
}

// ─── Item operations ──────────────────────────────────────────────────
function setEventItems(state: AppState, eventId: string, items: Item[]): AppState {
  const event = state.events.find((e) => e.id === eventId);
  if (!event) return state;
  const updatedEvent: Event = { ...event, items };
  return updateEvent(state, updatedEvent);
}

// ─── Transaction operations ───────────────────────────────────────────
function addTransaction(state: AppState, eventId: string, transaction: Transaction): AppState {
  const event = state.events.find((e) => e.id === eventId);
  if (!event) return state;
  const updatedEvent: Event = { ...event };
  updatedEvent.transactions = [...event.transactions, transaction];
  return updateEvent(state, updatedEvent);
}

function setDeviceName(state: AppState, deviceName: string): AppState {
  const newState: AppState = { ...state, deviceName: deviceName.trim() };
  saveState(newState);
  return newState;
}

// ─── Close event ──────────────────────────────────────────────────────
function closeEvent(state: AppState, eventId: string): AppState {
  const event = state.events.find((e) => e.id === eventId);
  if (!event) return state;
  const updatedEvent: Event = { ...event, closed: true };
  let newState = updateEvent(state, updatedEvent);
  if (newState.activeEventId === eventId) {
    newState = { ...newState, activeEventId: null };
    saveState(newState);
  }
  return newState;
}

// ─── Delete event ─────────────────────────────────────────────────────
function deleteEvent(state: AppState, eventId: string): AppState {
  const newState: AppState = { ...state };
  newState.events = state.events.filter((e) => e.id !== eventId);
  if (newState.activeEventId === eventId) {
    newState.activeEventId = null;
  }
  saveState(newState);
  return newState;
}

// ─── Persistent storage ───────────────────────────────────────────────
// Without persistence the browser may evict localStorage under storage pressure.
type PersistenceStatus = 'persisted' | 'not-persisted' | 'unsupported';

function storageManager(): StorageManager | null {
  if (typeof navigator === 'undefined' || !navigator.storage) return null;
  if (typeof navigator.storage.persisted !== 'function' || typeof navigator.storage.persist !== 'function') return null;
  return navigator.storage;
}

async function getPersistenceStatus(): Promise<PersistenceStatus> {
  const manager = storageManager();
  if (!manager) return 'unsupported';
  try {
    return (await manager.persisted()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'unsupported';
  }
}

async function requestPersistence(): Promise<PersistenceStatus> {
  const manager = storageManager();
  if (!manager) return 'unsupported';
  try {
    if (await manager.persisted()) return 'persisted';
    return (await manager.persist()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'unsupported';
  }
}

// ─── Reset (for testing / manual reset) ───────────────────────────────
function resetState(): AppState {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return defaultState();
}

export const Storage = {
  STORAGE_KEY,
  defaultState,
  loadState,
  saveState,
  addEvent,
  setActiveEvent,
  getActiveEvent,
  updateEvent,
  setEventItems,
  addTransaction,
  setDeviceName,
  closeEvent,
  deleteEvent,
  getPersistenceStatus,
  requestPersistence,
  resetState,
};

export type { AppState, PersistenceStatus };
