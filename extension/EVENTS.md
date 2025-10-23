# Event Capture Matrix

The recorder is driven by `event-config.json`, which declares every DOM and navigation event we monitor. Each entry has a `name`, an `enabled` flag, and the handler the extension invokes. To toggle capture, set `enabled` to `true` or `false`. To introduce a new event, append it to the relevant list in `event-config.json` with the handler you implement in `recorder.js`.

## DOM Events

| Event Name  | Default | Handler                  | Notes                                   |
|-------------|---------|--------------------------|-----------------------------------------|
| `click`     | true    | `recordEvent`            | Pointer clicks                          |
| `mousedown` | true    | `recordEvent`            | Mouse button press                      |
| `mouseup`   | true    | `recordEvent`            | Mouse button release                    |
| `mouseover` | true    | `recordEvent`            | Pointer enters element                  |
| `mouseout`  | true    | `recordEvent`            | Pointer leaves element                  |
| `keydown`   | true    | `recordEvent`            | Key press down                          |
| `keyup`     | true    | `recordEvent`            | Key release                             |
| `keypress`  | true    | `recordEvent`            | Printable key input                     |
| `scroll`    | true    | `debouncedRecordScroll`  | Captures scroll positions               |
| `input`     | true    | `debouncedRecordInput`   | Input value updates                     |
| `change`    | true    | `debouncedRecordInput`   | Committed value change                  |
| `focus`     | true    | `recordEvent`            | Element focus                           |
| `blur`      | true    | `recordEvent`            | Element blur                            |
| `submit`    | true    | `recordEvent`            | Form submission                         |
| `touchstart`| true    | `recordEvent`            | Touch start on mobile                   |
| `touchend`  | true    | `recordEvent`            | Touch end on mobile                     |
| `touchmove` | true    | `recordEvent`            | Touch move/drag on mobile               |

**Add a new DOM event:**
1. Append an object to `domEvents` in `event-config.json`, e.g.
   ```json
   { "name": "contextmenu", "enabled": true, "handler": "recordEvent", "description": "Right-clicks" }
   ```
2. If the handler is new (not `recordEvent`, `debouncedRecordInput`, or `debouncedRecordScroll`), add the function in `recorder.js` and map it in `getHandlerByKey`.

## Navigation Events

| Event Name    | Default | Notes                                      |
|---------------|---------|--------------------------------------------|
| `popstate`    | true    | Browser back/forward navigation (emits `popstate`) |
| `pushState`   | true    | SPA route changes via history API          |
| `replaceState`| true    | SPA history replacements                   |
| `beforeunload`| true    | Warn when page is leaving / refreshing     |

Recorded navigation events use the same `type` value as the underlying browser event (e.g., `popstate`, `pushState`).

Handlers for navigation events are fixed in `recorder.js` (`handleNavigation`, `handleBeforeUnload`). To add more, extend `NAVIGATION_HANDLER_MAP` and reference the handler in `event-config.json`.

## Observer Toggle

`event-config.json` also includes an `observers.dynamicDom` flag. When `true`, a `MutationObserver` logs structural changes to the DOM while recording. Set it to `false` to disable that observer.

## Workflow for Extending Capture

1. Update `event-config.json` with the new entry (set `enabled: true`).
2. If needed, implement the handler in `recorder.js` and expose it via `getHandlerByKey` or `NAVIGATION_HANDLER_MAP`.
3. Reload the Chrome extension so the new configuration and code are applied.

That file (`event-config.json`) is the single source of truth for which events are active; edits there will be picked up next time the recorder initializes.
