# Event Capture Service

This repository contains a Chrome extension that captures user events and a backend API (FastAPI + PyMongo) that writes those events to MongoDB Atlas.

## Index
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Config (Central Driver)](#config-central-driver)
- [API](#api)
- [Output](#output)
- [Storage](#storage)
- [Notes](#notes)

## Prerequisites

- MongoDB Atlas cluster and connection string
- Chrome (for loading the extension)
- Python 3.10+ for the FastAPI server

## Quick Start

Copy/paste these commands in a terminal from this folder:

```bash
# 1) Install Poetry (if you don't have it)
curl -sSL https://install.python-poetry.org | python3 -

# 2) Install project dependencies (inside server/)
(cd server && poetry install)

# 3) Copy env template and edit credentials
cp server/.env.example server/.env
# Open server/.env and set ATLAS_URI, API_KEY (optional), etc.

# 4) Start the API server on port 3000 (from server/)
(cd server && poetry run uvicorn server:app --host 0.0.0.0 --port 3000 --reload)
```

Then load the Chrome extension:
- Open Chrome > Extensions > Enable Developer mode > Load unpacked
- Select the `extension/` directory (the folder containing `manifest.json`)
- The extension will POST to `http://localhost:3000/api/events` by default

If you use MongoDB Atlas: create a free cluster, click the "Connect" button, and copy the connection string (Mongo URI). Replace it in `server/.env` as `ATLAS_URI`.

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
- Some entries may include a `screenshot` flag (historically used; currently screenshots are disabled in code).

Fields:
- `name`: The DOM or navigation event name (e.g., `click`, `input`, `popstate`).
- `enabled`: `true` to attach a listener and record the event; `false` to skip.
- `handler`: Which function the recorder will attach for this event (`recordEvent`, `debouncedRecordInput`, `debouncedRecordScroll`).
- `screenshot` (legacy): Whether a screenshot was intended at the time of this event (not active now).

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
| navigation   | Page navigations                                 | `/home` → `/profile`
| pageLoad     | Initial page load                                | Page title and URL
| focus/blur   | Focus gained/lost                                | Focusing an input
| touch*       | Mobile touch interactions                        | `touchstart` on element

Adding a new event type:
1. Add an entry in `extension/event-config.json` (set `enabled: true` and choose a `handler`).
2. If it needs special handling, add logic in `extension/recorder.js` (e.g., extend `recordEvent` or add a new handler and map it in `getHandlerByKey`).
3. Optionally add a summary row to the table above in this README.

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

## Output

Where to find the data:
- MongoDB: Database = value of `ALLOWED_DB`; Collection = value of `EVENT_COLLECTION` (see `server/.env`).
- Local disk: `<project-root>/intermediate/<ISO-timestamp>/payload.json` and `metadata.json`.

Sample MongoDB document (click to expand):
<details>
<summary>Show sample document</summary>

```json
{
  "task": "Search and submit",
  "duration": 42,
  "events_recorded": 3,
  "start_url": "https://example.com",
  "end_url": "https://example.com/results",
  "data": [
    {
      "type": "pageLoad",
      "timestamp": "2025-10-06T16:28:10.123Z",
      "url": "https://example.com",
      "title": "Home"
    },
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
      "type": "navigation",
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
