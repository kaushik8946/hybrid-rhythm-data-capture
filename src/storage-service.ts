/**
 * StorageService
 * ==============
 * Encapsulates all persistence for captured attendance data.
 *
 * Strategy:
 *   1. Primary  — chrome.storage.local  (MV3 service-worker safe, no DOM required,
 *                 persists across extension restarts, ~10 MB quota).
 *   2. Fallback — in-memory Map        (only if chrome.storage is somehow absent;
 *                 data is lost on service-worker termination but the capture path
 *                 continues to work without throwing).
 *
 * IndexedDB is intentionally NOT used here: MV3 service workers can have their
 * IndexedDB connection killed mid-operation when the worker is suspended, which
 * produces hard-to-diagnose data loss.  chrome.storage.local is the canonical
 * MV3 persistence API and is synchronisation-safe across workers.
 *
 * All public methods are async so the calling code is storage-backend agnostic.
 */

const STORAGE_KEY_DATA = 'attendanceData';
const STORAGE_KEY_UPDATED = 'attendanceLastUpdated';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AttendanceRecord {
  /** ISO-8601 timestamp of when the data was captured. */
  lastUpdated: string;
  /** The raw parsed JSON payload from the getUpdatedEmployeeData API. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: unknown;
}

// ---------------------------------------------------------------------------
// In-memory fallback (only used when chrome.storage is unavailable)
// ---------------------------------------------------------------------------

const _memoryStore = new Map<string, unknown>();

function hasExtensionStorage(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.storage !== 'undefined' &&
    typeof chrome.storage.local !== 'undefined'
  );
}

async function storageGet(key: string): Promise<unknown> {
  if (hasExtensionStorage()) {
    const result = await chrome.storage.local.get(key);
    return result[key];
  }
  return _memoryStore.get(key);
}

async function storageSet(key: string, value: unknown): Promise<void> {
  if (hasExtensionStorage()) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }
  _memoryStore.set(key, value);
}

async function storageRemove(keys: string[]): Promise<void> {
  if (hasExtensionStorage()) {
    await chrome.storage.local.remove(keys);
    return;
  }
  keys.forEach((k) => _memoryStore.delete(k));
}

// ---------------------------------------------------------------------------
// Public StorageService API
// ---------------------------------------------------------------------------

/**
 * Persist captured attendance data.
 * Overwrites any previously stored snapshot — we only ever keep the latest.
 */
export async function saveAttendanceData(data: unknown): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all([
    storageSet(STORAGE_KEY_DATA, data),
    storageSet(STORAGE_KEY_UPDATED, now),
  ]);
  console.log('[HRDC:storage] Attendance data saved at', now);
}

/**
 * Retrieve the most-recently captured attendance data.
 * Returns null if nothing has been saved yet.
 */
export async function getAttendanceData(): Promise<unknown | null> {
  const data = await storageGet(STORAGE_KEY_DATA);
  return data ?? null;
}

/**
 * Wipe all stored attendance data and its timestamp.
 */
export async function clearAttendanceData(): Promise<void> {
  await storageRemove([STORAGE_KEY_DATA, STORAGE_KEY_UPDATED]);
  console.log('[HRDC:storage] Attendance data cleared');
}

/**
 * Return the ISO-8601 timestamp of the last successful save,
 * or null if no data has ever been saved.
 */
export async function getLastUpdated(): Promise<string | null> {
  const ts = await storageGet(STORAGE_KEY_UPDATED);
  return typeof ts === 'string' ? ts : null;
}
