# Hybrid Rhythm Data Capture (HRDC)

A Chrome Manifest V3 extension that acts as a **secure local bridge**: it passively captures attendance data from the internal Hybrid Rhythm web app, stores it in `chrome.storage.local`, and makes it readable **only** to the Attendance Forecast web app via origin-verified extension messaging.

No file downloads. No cloud APIs. No outbound network calls. Captured data never leaves the device except into the one allowlisted origin that asks for it.

---

## Table of contents

- [How it works](#how-it-works)
- [Security model](#security-model)
- [Project layout](#project-layout)
- [Getting started](#getting-started)
- [Loading the extension in Chrome](#loading-the-extension-in-chrome)
- [Messaging API (for Attendance Forecast)](#messaging-api-for-attendance-forecast)
- [Storage schema](#storage-schema)
- [Configuration](#configuration)
- [Debugging](#debugging)
- [Known caveats](#known-caveats)

---

## How it works

The capture path crosses three JavaScript contexts, because the page's own `fetch`/`XMLHttpRequest` can only be wrapped from the page's own world, while `chrome.runtime` is only available in an extension world.

```
Hybrid Rhythm (IBM intranet host)
      │  page calls .../getUpdatedEmployeeData
      │
      ▼
content-script-loader.js        ← MAIN world, document_start
      │  wraps window.fetch and XMLHttpRequest.prototype.{open,send}
      │  clones the response, dispatches CustomEvent '__hrdc_employee_data__'
      ▼
content-bridge.ts               ← ISOLATED world, document_start
      │  chrome.runtime.sendMessage({ type: 'EMPLOYEE_DATA_CAPTURED', payload })
      ▼
background.ts                   ← MV3 service worker
      │  JSON.parse → saveAttendanceData()
      ▼
chrome.storage.local            ← extension-managed, on-device only
      ▲
      │  chrome.runtime.sendMessage(extensionId, { type: 'GET_ATTENDANCE_DATA' })
      │  answered only after origin verification
      │
Attendance Forecast  (https://attendance-forecast.netlify.app)
```

### Interception details

`public/content-script-loader.js` wraps **both** transports, since it isn't known which one Hybrid Rhythm uses for a given call:

- **`fetch`** — the original promise is returned to the page immediately and un-awaited. Capture happens on a `response.clone()`, so the page's own body reader is never consumed or delayed.
- **`XMLHttpRequest`** — `open()` records the URL on the instance under a non-enumerable `__hrdcUrl` property (so page code iterating the XHR object doesn't see it); `send()` attaches a `load` listener via `addEventListener` so the page's own `onload` handler stays untouched.

Only URLs containing the substring `getUpdatedEmployeeData` are captured. Every hook is wrapped in `try`/`catch` and fails open — a capture failure must never break the host page's request.

---

## Security model

| Control | Where |
| --- | --- |
| Capture is scoped to two intranet hosts only | `host_permissions` + `content_scripts.matches` in `public/manifest.json` |
| Only two origins may connect at all | `externally_connectable.matches` in `public/manifest.json` |
| Every external message is re-checked against an allowlist at runtime | `ALLOWED_ORIGINS` in [src/background.ts](src/background.ts) (defence-in-depth) |
| Unauthorized senders get an explicit rejection, never data | `{ success: false, error: 'Unauthorized origin' }` |
| Data stays on device | `chrome.storage.local` only — no downloads, no fetch-out |
| Extension ID is pinned | `key` field in the manifest, paired with `hrdc-private-key.pem` |
| Only the latest snapshot is kept | `saveAttendanceData()` overwrites; no history accumulates |

**The `ALLOWED_ORIGINS` set in `src/background.ts` must stay in sync with `externally_connectable.matches` in the manifest.** They are two independent gates over the same list; changing one without the other either silently blocks a legitimate caller or leaves a manifest entry that the runtime check rejects.

### The signing key

`hrdc-private-key.pem` at the repo root pairs with the `key` field in `public/manifest.json`. Together they pin a stable extension ID across reloads and machines, which matters because Attendance Forecast addresses the extension by ID. The key is excluded from version control by the `*.pem` rule in [.gitignore](.gitignore) — **never commit or share it**. Anyone holding it can publish an extension that Attendance Forecast will trust as this one.

---

## Project layout

```
.
├── public/                      # copied verbatim into dist/ by Vite
│   ├── manifest.json            # MV3 manifest — the source of truth for permissions
│   ├── content-script-loader.js # MAIN-world fetch/XHR interceptor (plain JS, not bundled)
│   ├── icons.svg
│   └── favicon.svg
├── src/
│   ├── background.ts            # service worker: message routing + origin verification
│   ├── content-bridge.ts        # ISOLATED-world relay: CustomEvent → chrome.runtime
│   ├── storage-service.ts       # chrome.storage.local wrapper + in-memory fallback
│   ├── main.ts, counter.ts,     # ── unused Vite starter scaffolding, see below
│   │   style.css, assets/       #
├── index.html                   # ── unused Vite starter scaffolding, see below
├── vite.config.ts               # two flat ES entry points, no hashing
├── tsconfig.json                # type-check only (noEmit), strict-ish linting flags
└── hrdc-private-key.pem         # gitignored — pins the extension ID
```

`content-script-loader.js` lives in `public/` rather than `src/` deliberately: it must reach the MAIN world as a self-contained IIFE with no module wrapper or import statements, so it bypasses the bundler entirely.

### Leftover scaffolding

`index.html`, `src/main.ts`, `src/counter.ts`, `src/style.css`, and `src/assets/` are remnants of the Vite TypeScript starter template (commits `ecab24b` / `514532c`). They are **not** part of the extension: `vite.config.ts` declares only `background` and `content-bridge` as inputs, so nothing in that list is bundled or shipped. `src/main.ts` and `src/counter.ts` are still type-checked by `tsc --noEmit` because `tsconfig.json` includes all of `src`. They can be deleted without affecting the build.

---

## Getting started

Requirements: Node.js with npm, and a Chromium-based browser.

```bash
npm install
```

### Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Type-checks with `tsc --noEmit`, then bundles into `dist/` |
| `npm run dev` | `vite build --watch` — rebuilds `dist/` on save (no dev server, no HMR) |
| `npm run preview` | Vite's static preview server. Inherited from the starter template; not useful for an extension. |

`npm run dev` is the working loop for extension development: it keeps `dist/` fresh, and you click **Reload** on the extension in `chrome://extensions` to pick up changes. Note that it does **not** run `tsc`, so run `npm run build` before shipping to catch type errors.

### Build output

`dist/` is gitignored and fully regenerated on each build (`emptyOutDir: true`):

```
dist/
├── manifest.json              ┐
├── content-script-loader.js   ├─ copied from public/
├── icons.svg                  │
├── favicon.svg                ┘
├── background.js              ┐ bundled from src/
└── content-bridge.js          ┘
```

Filenames are unhashed and flat (`entryFileNames: '[name].js'`, ES format) because MV3 requires the service worker and content scripts at the fixed paths named in the manifest.

---

## Loading the extension in Chrome

1. `npm run build`
2. Open `chrome://extensions`
3. Enable **Developer mode** (top right)
4. **Load unpacked** → select the `dist/` folder
5. Confirm the extension ID shown matches the one Attendance Forecast is configured with — the `key` in the manifest should make it stable

After a rebuild, click **Reload** on the extension card. Reloading is required for service worker changes; content script changes also need a refresh of any open Hybrid Rhythm tab.

---

## Messaging API (for Attendance Forecast)

Attendance Forecast talks to the extension with `chrome.runtime.sendMessage(extensionId, message)`. This works from a normal web page only because the page's origin is listed in `externally_connectable.matches`.

```js
const EXTENSION_ID = '<your extension id>';

chrome.runtime.sendMessage(
  EXTENSION_ID,
  { type: 'GET_ATTENDANCE_DATA' },
  (response) => {
    if (!response?.success) {
      console.error('HRDC request failed:', response?.error);
      return;
    }
    console.log(response.data, response.lastUpdated);
  }
);
```

### Message types

| `type` | Response on success | Notes |
| --- | --- | --- |
| `GET_ATTENDANCE_DATA` | `{ success: true, data, lastUpdated }` | `data` is `null` if nothing has been captured yet |
| `GET_LAST_UPDATED` | `{ success: true, lastUpdated }` | `lastUpdated` is `null` if never captured; cheap freshness poll |
| `CLEAR_ATTENDANCE_DATA` | `{ success: true }` | Wipes the snapshot and its timestamp |

### Failure responses

| Response | Cause |
| --- | --- |
| `{ success: false, error: 'Unauthorized origin' }` | Sender origin not in `ALLOWED_ORIGINS` |
| `{ success: false, error: 'Unknown message type' }` | Unrecognised `type` |
| `{ success: false, error: '<message>' }` | Storage threw; stringified error |
| `chrome.runtime.lastError`, no response | Extension not installed, wrong ID, or origin not in `externally_connectable` (the message never reached the listener at all) |

Always check `response?.success` rather than assuming `data` is present. A missing response and a rejected response are different failures with different fixes: the first is a manifest/ID problem, the second is an `ALLOWED_ORIGINS` problem.

### Internal message type

`EMPLOYEE_DATA_CAPTURED` (with a `payload` string of raw JSON) is sent by `content-bridge.ts` over `chrome.runtime.onMessage` and is not part of the external surface.

---

## Storage schema

Two independent keys in `chrome.storage.local`, written together by `saveAttendanceData()`:

| Key | Value |
| --- | --- |
| `attendanceData` | The raw parsed JSON payload from `getUpdatedEmployeeData`, stored as-is with no reshaping |
| `attendanceLastUpdated` | ISO-8601 capture timestamp, e.g. `2026-08-20T09:14:03.221Z` |

Each capture **overwrites** the previous one — only the latest snapshot is ever kept, so storage does not grow over time.

### Why not IndexedDB

`src/storage-service.ts` documents the reasoning: an MV3 service worker can be suspended mid-operation and have its IndexedDB connection killed, producing data loss that is hard to diagnose. `chrome.storage.local` is the canonical MV3 persistence API, needs no DOM, survives worker restarts, and is synchronisation-safe across workers (~10 MB quota).

A `Map`-based in-memory fallback kicks in only if `chrome.storage.local` is somehow absent, so the capture path keeps working rather than throwing. Data in that fallback dies with the worker — it is a safety net, not a supported mode.

---

## Configuration

There is no config file; environment-specific values are literals that must be edited in two places.

**To change the Hybrid Rhythm host**, edit `public/manifest.json` — both `host_permissions` and both `content_scripts[].matches` arrays. Currently:

```
https://chebz162229098.sl2469408.sl.dst.ibm.com/*
https://chebz162229098.sl2469408.sl.dst.ibm.com:9443/*
```

**To change which app may read the data**, edit both:

1. `externally_connectable.matches` in `public/manifest.json`
2. `ALLOWED_ORIGINS` in [src/background.ts](src/background.ts)

Currently `https://attendance-forecast.netlify.app` (production) and `http://localhost:5173` (Vite dev default).

**To change the captured endpoint**, edit the `TARGET` constant in `public/content-script-loader.js` (currently `'getUpdatedEmployeeData'`, matched as a substring of the URL).

The `EVENT_NAME` constant `'__hrdc_employee_data__'` appears in both `public/content-script-loader.js` and `src/content-bridge.ts` and must match.

---

## Debugging

All extension logging is prefixed by component, so filter the console on `HRDC`:

- `[HRDC:background]` — capture received and stored
- `[HRDC:bridge]` — external request authorized or rejected
- `[HRDC:storage]` — save and clear operations

### Where to look

| Context | How to open |
| --- | --- |
| Service worker (`background.js`) | `chrome://extensions` → the extension card → **service worker** link |
| ISOLATED-world bridge | Hybrid Rhythm tab DevTools console, context dropdown → the extension |
| MAIN-world interceptor | Hybrid Rhythm tab DevTools console, default `top` context |
| Stored data | Service worker console: `await chrome.storage.local.get()` |

### Common failures

**Nothing is captured.** Confirm the Hybrid Rhythm tab's URL matches a `content_scripts.matches` pattern (including the port — `:9443` is a separate entry from the default). Then check the Network tab for a `getUpdatedEmployeeData` request. If the response is a non-JSON body, or an XHR with `responseType` set to `arraybuffer`/`blob`/`document`, the payload is silently discarded by design.

**Requests are rejected.** Check the service worker console for the `Rejected request from unauthorized origin:` warning — it logs the exact origin seen, which is usually a scheme, port, or trailing-slash mismatch against `ALLOWED_ORIGINS`.

**No response at all.** The message never reached the listener: wrong extension ID, or the caller's origin isn't in `externally_connectable.matches`. Content-script and service-worker changes both require **Reload** on the extension card.

---

## Known caveats

- **No popup, options page, or UI.** The extension is entirely headless; the only user-visible surface is its icon in `chrome://extensions`. All observability is via console logs.
- **Capture is passive.** Data appears only after Hybrid Rhythm itself calls `getUpdatedEmployeeData`. The extension never triggers that request, so Attendance Forecast can get `data: null` simply because nobody has opened Hybrid Rhythm recently — poll `GET_LAST_UPDATED` to check freshness.
- **Silent-by-design discards.** Non-JSON payloads, unserialisable values, and unreadable response bodies are dropped without logging, to guarantee the host page is never affected. This makes "captured nothing" quieter than you might want when diagnosing.
- **No tests and no linter.** There is no test runner or ESLint config in the project. The ESLint disable comment in `src/storage-service.ts` is vestigial. `tsc --noEmit` via `npm run build` is the only automated check.
- **`tsconfig.json` does not enable `strict`.** It sets `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, and `noFallthroughCasesInSwitch`, but strict null checking is off.
- **Payloads are stored unvalidated.** `background.ts` does `JSON.parse` and persists the result as `unknown` with no schema check, so a change in the Hybrid Rhythm response shape surfaces downstream in Attendance Forecast rather than here.
