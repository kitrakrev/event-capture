# Event Capture Service

This repository contains the Chrome extension for capturing user events and a backend API that writes those events to MongoDB Atlas. You can run the backend with either Node/Express or FastAPI/PyMongo.

## Prerequisites

- MongoDB Atlas cluster and connection string
- Chrome (for loading the extension)
- Optional runtimes depending on the backend you choose:
  - Node.js 18+ for the Express server
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

Create `server/.env` (copied from `server/.env.example`). Example:

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

## Example event-config

Save as `extension/event-config.json` to control which DOM events are captured by the content script.

```json
{
  "domEvents": [
    { "name": "click", "enabled": true, "handler": "recordEvent" },
    { "name": "mousedown", "enabled": false, "handler": "recordEvent" },
    { "name": "mouseup", "enabled": false, "handler": "recordEvent" },
    { "name": "mouseover", "enabled": false, "handler": "recordEvent" },
    { "name": "mouseout", "enabled": false, "handler": "recordEvent" },
    { "name": "keydown", "enabled": false, "handler": "recordEvent" },
    { "name": "keyup", "enabled": false, "handler": "recordEvent" },
    { "name": "keypress", "enabled": false, "handler": "recordEvent" },
    { "name": "scroll", "enabled": false, "handler": "debouncedRecordScroll" },
    { "name": "input", "enabled": false, "handler": "debouncedRecordInput" },
    { "name": "change", "enabled": false, "handler": "debouncedRecordInput" },
    { "name": "focus", "enabled": false, "handler": "recordEvent" },
    { "name": "blur", "enabled": false, "handler": "recordEvent" },
    { "name": "submit", "enabled": false, "handler": "recordEvent" },
    { "name": "touchstart", "enabled": false, "handler": "recordEvent" },
    { "name": "touchend", "enabled": false, "handler": "recordEvent" },
    { "name": "touchmove", "enabled": false, "handler": "recordEvent" }
  ],
  "navigationEvents": [
    { "name": "popstate", "enabled": false },
    { "name": "pushState", "enabled": false },
    { "name": "replaceState", "enabled": false },
    { "name": "beforeunload", "enabled": false }
  ],
  "observers": { "dynamicDom": false }
}
```

Note: Currently, a `pageLoad` event and background events like `navigation` / `newTab` may be recorded irrespective of DOM listeners. If you want only `click` events, we can gate those by config as well.

---

## API

- POST `/api/events`
  - Headers: `Content-Type: application/json`, `x-api-key: <API_KEY>` (if configured)
  - Body:
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
