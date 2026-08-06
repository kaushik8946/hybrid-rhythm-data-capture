/**
 * Background Service Worker
 * =========================
 * This file is the core of the secure local bridge between Hybrid Rhythm and
 * Attendance Forecast.
 *
 * Architecture overview:
 *
 *   Hybrid Rhythm (IBM intranet)
 *         │  fetch intercepted by content-script-loader.js  (MAIN world)
 *         ▼
 *   content-bridge.js  (ISOLATED world)
 *         │  chrome.runtime.sendMessage({ type: 'EMPLOYEE_DATA_CAPTURED' })
 *         ▼
 *   background.ts  ◄── YOU ARE HERE
 *         │  saveAttendanceData()
 *         ▼
 *   chrome.storage.local  (extension-managed, never leaves the device)
 *         │
 *         │  chrome.runtime.sendMessage({ type: 'GET_ATTENDANCE_DATA' })
 *         │  (only from the verified origin below)
 *         ▼
 *   Attendance Forecast  (https://attendance-forecast.netlify.app)
 *
 * Security model:
 *   - Data is stored exclusively in chrome.storage.local.
 *   - No file downloads, no cloud APIs, no external network calls.
 *   - Attendance Forecast may only read data by sending a runtime message
 *     through an externally_connectable channel.
 *   - Every inbound message is checked against the ALLOWED_ORIGIN allowlist
 *     before any data is returned.  Requests from any other origin receive
 *     an explicit { success: false, error: 'Unauthorized origin' } response.
 */

import {
  saveAttendanceData,
  getAttendanceData,
  clearAttendanceData,
  getLastUpdated,
} from './storage-service.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * External origins permitted to query stored attendance data.
 * Checked at runtime in the onMessageExternal listener (defence-in-depth).
 * Must stay in sync with externally_connectable.matches in manifest.json.
 */
const ALLOWED_ORIGINS = new Set([
  'https://attendance-forecast.netlify.app', // production
  'http://localhost:5173',                   // local dev (Vite default port)
]);

// ---------------------------------------------------------------------------
// Internal message types (Hybrid Rhythm → extension)
// ---------------------------------------------------------------------------

interface EmployeeDataCapturedMessage {
  type: 'EMPLOYEE_DATA_CAPTURED';
  payload: string; // JSON string of the raw API response
}

// ---------------------------------------------------------------------------
// External message types (Attendance Forecast → extension)
// ---------------------------------------------------------------------------

type ExternalMessageType =
  | 'GET_ATTENDANCE_DATA'
  | 'GET_LAST_UPDATED'
  | 'CLEAR_ATTENDANCE_DATA';

interface ExternalMessage {
  type: ExternalMessageType;
}

// ---------------------------------------------------------------------------
// Listener: captures from Hybrid Rhythm (internal content script messages)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (message: EmployeeDataCapturedMessage, _sender, sendResponse) => {
    if (message.type !== 'EMPLOYEE_DATA_CAPTURED') {
      // Not a message we handle — do not send a response.
      return false;
    }

    console.log('[HRDC:background] Employee data received, storing locally...');

    // Parse and persist asynchronously; return true to keep the channel open.
    (async () => {
      try {
        const parsed: unknown = JSON.parse(message.payload);
        await saveAttendanceData(parsed);
        console.log('[HRDC:background] Attendance data stored successfully.');
        sendResponse({ success: true });
      } catch (err) {
        console.error('[HRDC:background] Failed to store attendance data:', err);
        sendResponse({ success: false, error: String(err) });
      }
    })();

    // Return true → we will call sendResponse asynchronously.
    return true;
  }
);

// ---------------------------------------------------------------------------
// Listener: bridge requests from Attendance Forecast (external messages)
//
// chrome.runtime.onMessageExternal fires when a web page sends a message via
// chrome.runtime.sendMessage(extensionId, ...).  The manifest must list the
// page's origin in "externally_connectable.matches" for this to work.
//
// Origin verification is performed here as a defence-in-depth measure even
// though the manifest allowlist already gates which origins can connect.
// ---------------------------------------------------------------------------

chrome.runtime.onMessageExternal.addListener(
  (message: ExternalMessage, sender, sendResponse) => {
    // --- Origin verification (primary security gate) ---
    const senderOrigin = sender.origin ?? sender.url ?? '';

    if (!ALLOWED_ORIGINS.has(senderOrigin)) {
      console.warn(
        '[HRDC:bridge] Rejected request from unauthorized origin:',
        senderOrigin
      );
      sendResponse({ success: false, error: 'Unauthorized origin' });
      return false;
    }

    console.log('[HRDC:bridge] Authorized request from:', senderOrigin, '| type:', message.type);

    // --- Dispatch to the appropriate StorageService method ---
    (async () => {
      try {
        switch (message.type) {
          case 'GET_ATTENDANCE_DATA': {
            const data = await getAttendanceData();
            const lastUpdated = await getLastUpdated();
            sendResponse({ success: true, data, lastUpdated });
            break;
          }

          case 'GET_LAST_UPDATED': {
            const lastUpdated = await getLastUpdated();
            sendResponse({ success: true, lastUpdated });
            break;
          }

          case 'CLEAR_ATTENDANCE_DATA': {
            await clearAttendanceData();
            sendResponse({ success: true });
            break;
          }

          default: {
            sendResponse({ success: false, error: 'Unknown message type' });
          }
        }
      } catch (err) {
        console.error('[HRDC:bridge] Error handling external message:', err);
        sendResponse({ success: false, error: String(err) });
      }
    })();

    // Return true → we will call sendResponse asynchronously.
    return true;
  }
);
