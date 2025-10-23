# Event Capture Service

This repository contains a Chrome extension that captures user events and a backend API (FastAPI + PyMongo) that writes those events to MongoDB Atlas.

## Components at a Glance

- ENV (connection and access): `server/.env`
  - Set your Mongo connection (`ATLAS_URI`) and access targets (`ALLOWED_DB`, `EVENT_COLLECTION`).
  - Optional: `API_KEY` to require an API key (if you set this, also set it in `extension/config.js`).
- Config (what to record): `extension/event-config.json`
  - Define which browser events are captured (`name`), whether they are enabled (`enabled`), and which handler to use (`handler`).

These two files are the only drivers; everything else reads from them.

## Index
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Config (Central Driver)](#config-central-driver)
- [API](#api)
- [How it works](#how-it-works)
- [Output](#output)
- [Storage](#storage)
- [Notes](#notes)

## Prerequisites

- MongoDB Atlas cluster and connection string
- Chrome (for loading the extension)
- Python 3.10+

## Setup

- Environment variables are already provided in this repo via `server/.env.example`.
  - Just copy it to `server/.env` and you will have the current access configuration (my access).
  - To view results in Mongo with the current defaults, see the "Where to find the data" link in the Output section.
  - If you want your own access: the current setup does not use an API key and points to my Atlas admin URI. Replace the following in `server/.env` with your values:
    - `ATLAS_URI` (your MongoDB connection string)
    - optionally `ALLOWED_DB` and `EVENT_COLLECTION`
    - if you set `API_KEY`, also set the same value in `extension/config.js` (`API_KEY` constant)
  - You can always view the output locally under `<project-root>/intermediate/<ISO-timestamp>/`.

## Quick Start

Run everything from the repository root (`capstone_git`):

```bash
# 0) Enter the project directory
cd event-capture

# 1) Create a virtual environment and install server dependencies
python3 -m venv server/.venv
source server/.venv/bin/activate
pip install -r server/requirements.txt

# 2) Copy env template and edit credentials (env is already in repo)
cp server/.env.example server/.env
# Open server/.env and set ATLAS_URI, API_KEY (optional), etc.

# 3) Start the API server on port 3000
server/.venv/bin/python -m uvicorn server.server:app --host 0.0.0.0 --port 3000 --reload
```

Then load the Chrome extension:
- Open Chrome > Extensions > Enable Developer mode > Load unpacked
- Select the `extension/` directory (the folder containing `manifest.json`)
- The extension will POST to `http://localhost:3000/api/events` by default

For subsequent shells, re-activate with:

```bash
source event-capture/server/.venv/bin/activate
```

> Credentials: See Setup for using the defaults or replacing with your own.

---

## Environment Variables

A template is already provided. Just copy it and edit your values:

```bash
cp server/.env.example server/.env
```

Example values inside `.env`:

```env
ATLAS_URI="mongodb+srv://<username>:<password>@<cluster-host>/?retryWrites=true&w=majority"
ALLOWED_DB="capstone"
ALLOWED_COLLECTIONS='["events"]'
EVENT_COLLECTION="events"
API_KEY="replace-with-strong-secret"
```

- ATLAS_URI: Your MongoDB connection string (Atlas or self-hosted)
- ALLOWED_DB: Database name the API is allowed to access
- ALLOWED_COLLECTIONS: JSON array of allowed collection names
- EVENT_COLLECTION: Collection used for `/api/events` inserts (should be in ALLOWED_COLLECTIONS)
- API_KEY: Optional. If set, calls must include the header `x-api-key: <API_KEY>`

---

## Config (Central Driver)

The central configuration for what gets recorded is `extension/event-config.json` (already present). This file drives which events are captured by the content script.

- It is the single source of truth for enabling/disabling categories of events.
- Each entry defines the browser event name, whether it is enabled, and which handler to use.
- Historical `screenshot` toggles have been removed now that screen recording is always on.

Fields:
- `name`: The DOM or navigation event name (e.g., `click`, `input`, `popstate`).
- `enabled`: `true` to attach a listener and record the event; `false` to skip.
- `handler`: Which function the recorder will attach for this event (`recordEvent`, `debouncedRecordInput`, `debouncedRecordScroll`).

Details (click to expand):
<details>
<summary>Example: domEvents and navigationEvents</summary>

```json
{
  "domEvents": [
    { "name": "click", "enabled": true,  "handler": "recordEvent" },
    { "name": "input", "enabled": false, "handler": "debouncedRecordInput" },
    { "name": "scroll", "enabled": false, "handler": "debouncedRecordScroll" }
  ],
  "navigationEvents": [
    { "name": "popstate",     "enabled": false },
    { "name": "pushState",    "enabled": false },
    { "name": "replaceState", "enabled": false },
    { "name": "beforeunload", "enabled": false }
  ],
  "observers": { "dynamicDom": false }
}
```
</details>

Event meanings and examples:

| Event name   | What it captures                               | Example
|--------------|--------------------------------------------------|--------
| click        | User clicks (button, link, interactive element) | Click on `#submit` button
| input        | Input text changes (debounced)                   | Typing in `#search` field
| change       | Committed value changes                          | Selecting from a `<select>`
| scroll       | Significant scrolls (debounced)                  | Scrolling page 200px
| keydown/up   | Keyboard presses/releases                        | Pressing `Enter`
| mouseover/out| Pointer enter/leave (interactive/tooltip)        | Hover over menu item
| submit       | Form submissions                                 | Submitting login form
| popstate/pushState/replaceState | Page navigations (recorded with the same event name) | `/home` → `/profile`
| focus/blur   | Focus gained/lost                                | Focusing an input
| touch*       | Mobile touch interactions                        | `touchstart` on element

Navigation events emitted by the recorder use the browser event name for `type` (e.g., `popstate`) and include `category: "navigation"` for downstream grouping.

Adding a new event type:
1. Add an entry in `extension/event-config.json` (set `enabled: true` and choose a `handler`).
2. If it needs special handling, add logic in `extension/recorder.js` (e.g., extend `recordEvent` or add a new handler and map it in `getHandlerByKey`).
3. Optionally add a summary row to the table above in this README.

### Recommended Settings (Required vs. Optional)

- Keep enabled (core flow integrity)
  - `click`: Primary interaction signal; required for almost every task.
  - `navigationEvents` (`popstate`, `pushState`, `replaceState`, `beforeunload`): Strongly recommended to reconstruct flows and correlate with screen video.
  - `submit`: Recommended for forms and e‑commerce (e.g., Add to Cart triggers form submits on many sites).
  - `change`: Recommended if you need actual selection/value changes (e.g., Quantity dropdowns, checkboxes, radios).
  - `input`: Recommended if you need typed text; disable if minimizing PII.

- Optional / noisy (enable only when needed)
  - `scroll`: High‑volume; enable if scroll position matters for analysis.
  - `mouseover` / `mouseout` (hover): High‑volume; enable for hover‑driven menus/tooltips.
  - `pointerdown` / `pointerup` / `mousedown` / `mouseup`: Usually redundant with `click`; enable for low‑level pointer diagnostics or exotic widgets.
  - `focus` / `blur`: Useful for detailed form flows; optional otherwise.
  - `keydown` / `keyup` / `keypress`: Enable for keyboard‑centric tasks; prefer `keydown`/`keyup` over legacy `keypress`.
  - `touchstart` / `touchend` / `touchmove`: Only for mobile/touch testing.
  - `observers.dynamicDom`: Enable to re‑mark dynamic pages (BrowserGym marks); may add CPU overhead.

Note: The recorder attaches early, capture‑phase listeners for robustness on sites that stop propagation; the `enabled` flags in `event-config.json` still govern which events are actually recorded.

### Lean Default (Core Signals Only)

The repo now defaults to a lean capture preset focused on core flow signals:

- Enabled: `click`, `input`, `change`, `submit`, and all `navigationEvents`.
- Disabled: everything else (scroll, hover, pointer low‑level, focus/blur, key*, touch*, etc.).

Example minimal config
```json
{
  "domEvents": [
    { "name": "click",  "enabled": true,  "handler": "recordEvent" },
    { "name": "input",  "enabled": true,  "handler": "debouncedRecordInput" },
    { "name": "change", "enabled": true,  "handler": "debouncedRecordInput" },
    { "name": "submit", "enabled": true,  "handler": "recordEvent" },
    { "name": "scroll", "enabled": false, "handler": "debouncedRecordScroll" },
    { "name": "mouseover", "enabled": false, "handler": "recordEvent" },
    { "name": "mouseout",  "enabled": false, "handler": "recordEvent" },
    { "name": "keydown",   "enabled": false, "handler": "recordEvent" },
    { "name": "keyup",     "enabled": false, "handler": "recordEvent" },
    { "name": "keypress",  "enabled": false, "handler": "recordEvent" },
    { "name": "pointerdown", "enabled": false, "handler": "recordEvent" },
    { "name": "pointerup",   "enabled": false, "handler": "recordEvent" }
  ],
  "navigationEvents": [
    { "name": "popstate",     "enabled": true },
    { "name": "pushState",    "enabled": true },
    { "name": "replaceState", "enabled": true },
    { "name": "beforeunload", "enabled": true }
  ],
  "observers": { "dynamicDom": false }
}
```

This keeps event volume low while preserving everything needed to reconstruct task flows (including SELECT dropdown changes and form submits like “Add to Cart”).

### Config Examples (Event → HTML → Recorded)

The snippets below show how an event is enabled in `event-config.json`, a minimal HTML that triggers it, and an excerpt of the recorded payload.

#### click

Config
```json
{ "name": "click", "enabled": true, "handler": "recordEvent" }
```

HTML
```html
<button id="buy">Add to Cart</button>
<!-- Amazon also uses <input type="submit" id="add-to-cart-button" /> -->
```

Recorded (excerpt)
```json
{ "type": "click", "target": { "tag": "BUTTON", "id": "buy", "text": "Add to Cart" } }
```

#### input (live typing)

Config
```json
{ "name": "input", "enabled": true, "handler": "debouncedRecordInput" }
```

HTML
```html
<label>Email <input id="email" type="email" /></label>
```

Recorded (excerpt)
```json
{ "type": "input", "target": { "id": "email" }, "inputType": "insertText", "data": "a" }
```

#### change (selects, checkboxes, committed changes)

Config
```json
{ "name": "change", "enabled": true, "handler": "debouncedRecordInput" }
```

HTML (Quantity dropdown)
```html
<label for="qty">Quantity:</label>
<select id="qty">
  <option>1</option>
  <option>2</option>
  <option>3</option>
  <!-- Amazon often uses a stylized span that forwards to a hidden <select>; enabling change captures the value update. -->
</select>
```

Recorded (excerpt)
```json
{ "type": "change", "target": { "tag": "SELECT", "id": "qty" }, "targetValue": "2" }
```

#### submit (form submissions)

Config
```json
{ "name": "submit", "enabled": true, "handler": "recordEvent" }
```

HTML
```html
<form id="f">
  <input name="q" />
  <button type="submit" id="go">Search</button>
</form>
```

Recorded (excerpt)
```json
{ "type": "submit", "target": { "tag": "FORM", "id": "f" } }
```

#### keydown / keyup / keypress

Config
```json
{ "name": "keydown", "enabled": true, "handler": "recordEvent" }
{ "name": "keyup",   "enabled": true, "handler": "recordEvent" }
{ "name": "keypress", "enabled": true, "handler": "recordEvent" }
```

HTML
```html
<input id="search" placeholder="Type and press Enter" />
```

Recorded (excerpt)
```json
{ "type": "keydown", "key": "Enter", "code": "Enter", "target": { "id": "search" } }
```

#### scroll

Config
```json
{ "name": "scroll", "enabled": true, "handler": "debouncedRecordScroll" }
```

HTML
```html
<div id="pane" style="height:120px; overflow:auto">
  <div style="height:800px"></div>
</div>
```

Recorded (excerpt)
```json
{ "type": "scroll", "target": { "id": "pane" }, "scroll": { "scrollTop": 120 } }
```

#### mouseover / mouseout

Config
```json
{ "name": "mouseover", "enabled": true, "handler": "recordEvent" }
{ "name": "mouseout",  "enabled": true, "handler": "recordEvent" }
```

HTML
```html
<a id="help" title="Opens help">Help</a>
```

Recorded (excerpt)
```json
{ "type": "mouseover", "target": { "id": "help" } }
```

#### pointer / touch (mobile/pen)

Config
```json
{ "name": "pointerdown", "enabled": true, "handler": "recordEvent" }
{ "name": "pointerup",   "enabled": true, "handler": "recordEvent" }
{ "name": "touchstart",  "enabled": true, "handler": "recordEvent" }
{ "name": "touchend",    "enabled": true, "handler": "recordEvent" }
{ "name": "touchmove",   "enabled": true, "handler": "recordEvent" }
```

HTML
```html
<button id="tap">Tap me</button>
```

Recorded (excerpt)
```json
{ "type": "pointerdown", "pointerType": "touch", "target": { "id": "tap" } }
```

#### navigation (SPA + back/forward)

Config
```json
{ "name": "popstate",     "enabled": true }
{ "name": "pushState",    "enabled": true }
{ "name": "replaceState", "enabled": true }
{ "name": "beforeunload", "enabled": true }
```

HTML/JS
```html
<button id="route">Go to /settings</button>
<script>
  document.getElementById('route').onclick = () => {
    history.pushState({}, '', '/settings');
  };
</script>
```

Recorded (excerpt)
```json
{ "type": "pushState", "fromUrl": "https://example.com/", "toUrl": "https://example.com/settings" }
```

---

## API

- POST `/api/events`
  - Headers: `Content-Type: application/json`, `x-api-key: <API_KEY>` (if configured)
  - Body (matches the Chrome extension payload shape):
    ```json
    {
      "task": "My Task Title",
      "duration": 123,
      "events_recorded": 2,
      "start_url": "https://example.com",
      "end_url": "https://example.com/page",
      "data": [
        {
          "type": "click",
          "timestamp": 1728213140000,
          "url": "https://example.com",
          "target": {
            "tag": "BUTTON",
            "id": "submit",
            "class": "btn primary",
            "text": "Submit",
            "value": "",
            "isInteractive": true,
            "xpath": "//*[@id=\"submit\"]",
            "cssPath": "button#submit.btn.primary",
            "bid": "button-primary-abc123",
            "a11y": { "role": "button", "name": "Submit" },
            "attributes": { "id": "submit", "class": "btn primary" },
            "boundingBox": { "x": 10, "y": 20, "width": 100, "height": 30 }
          }
        }
      ]
    }
    ```
  - Response:
    ```json
    { "success": true, "documentId": "<mongo-id>" }
    ```

---

## How it works

Chrome Extension → FastAPI → MongoDB

- Chrome extension (popup + content script) captures user actions based on `extension/event-config.json` and builds a payload.
- FastAPI (`server/server.py`) accepts POST `/api/events`, inserts into MongoDB, and writes a local snapshot under `intermediate/<timestamp>/`.
- You can view results immediately on disk, or in Mongo using the connection from your `server/.env`.

---

## Output

Where to find the data:
- MongoDB (current defaults in this repo):
  - Database: `capstone`
  - Collection: `events`
  - Copy/paste Connection (MongoDB Compass/Driver):
    `mongodb+srv://sid:REDACTED@capstone.xydgfjo.mongodb.net/capstone?retryWrites=true&w=majority&appName=capstone`
  - If you change `ALLOWED_DB` or `EVENT_COLLECTION` in `server/.env`, open that DB/collection accordingly.
- Local disk: `<project-root>/intermediate/<ISO-timestamp>/payload.json` and `metadata.json`.

Sample MongoDB document (click to expand):
<details>
<summary>Show sample document</summary>

```json
{
  "task": "Search and submit",
  "duration": 42,
  "events_recorded": 2,
  "start_url": "https://example.com",
  "end_url": "https://example.com/results",
  "data": [
    {
      "type": "click",
      "timestamp": 1728213140000,
      "url": "https://example.com",
      "target": {
        "tag": "BUTTON",
        "id": "submit",
        "class": "btn primary",
        "text": "Submit",
        "value": "",
        "isInteractive": true,
        "xpath": "//*[@id=\"submit\"]",
        "cssPath": "button#submit.btn.primary",
        "bid": "button-primary-abc123",
        "a11y": { "role": "button", "name": "Submit" },
        "attributes": { "id": "submit", "class": "btn primary" },
        "boundingBox": { "x": 10, "y": 20, "width": 100, "height": 30 }
      }
    },
    {
      "type": "popstate",
      "category": "navigation",
      "timestamp": "2025-10-06T16:28:20.456Z",
      "fromUrl": "https://example.com",
      "toUrl": "https://example.com/results",
      "title": "Results",
      "referrer": "https://example.com",
      "fromUserInput": true
    }
  ],
  "timestamp": "2025-10-06T16:29:14.694Z"
}
```
</details>

---

## Storage

- MongoDB: Documents are inserted into database `ALLOWED_DB` and collection `EVENT_COLLECTION` (both from `server/.env`).
- Local intermediate archive:
  - The server writes files under `<project-root>/intermediate/<ISO-timestamp>/`:
    - `payload.json`: the request payload data
    - `metadata.json`: save time, inserted id, counts, and file paths

Find these under the project root after a successful POST.

---

## Notes

- The Chrome extension code lives in `extension/` and posts to the API via `extension/config.js`.
- If you set `API_KEY` in `server/.env`, also set it in the extension to send the `x-api-key` header.
- To customize captured events, edit `extension/event-config.json`.
