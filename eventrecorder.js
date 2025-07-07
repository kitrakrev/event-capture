// 1) Grouped event types
const eventTypes = [
  // — Mouse —
  'click', 'mousedown', 'mouseup', 'mouseover', 'mouseout',

  // — Keyboard —
  'keydown', 'keyup', 'keypress',

  // — Scroll / Touch —
  /*'scroll'*/, 'touchstart', 'touchmove', 'touchend',

  // — Form —
  'input', 'focus', 'blur', 'change', 'submit'
];



// // 2) Wire up the interceptor for each event
// eventTypes.forEach(type => {
//   document.addEventListener(type, interceptAndReplay, true);
// });


(function(){
  if (window.location.href && window.location.href !== '') {
    eventTypes.forEach(type => {
      document.addEventListener(type, interceptAndReplay, {
        capture: true,
        passive: false
      });
    });
  }
})();

let lastCapture = 0;
const CAPTURE_INTERVAL = 500; // ms
function fetchScreenshot() {
  return new Promise(resolve => {
    // guard against missing API
    if (!chrome.runtime?.sendMessage) {
      return resolve(null);
    }

    try {
      chrome.runtime.sendMessage(
        { action: 'captureScreenshot' },
        resp => {
          // check runtime.lastError (e.g. “context invalidated”)
          if (chrome.runtime.lastError) {
            console.warn(
              'fetchScreenshot failed:',
              chrome.runtime.lastError.message
            );
            return resolve(null);
          }
          resolve(resp.screenshot);
        }
      );
    } catch (err) {
      console.warn('fetchScreenshot threw synchronously:', err);
      resolve(null);
    }
  });
}

async function fetchScreenshotThrottled() {
  const now = Date.now();
  if (now - lastCapture < CAPTURE_INTERVAL) return null;
  lastCapture = now;
  return fetchScreenshot();
}


function getAccessibilityTree() {
  return new Promise((resolve, reject) => {
    if (attachedTabId === null) {
      return reject("Not attached to any tab");
    }
    chrome.debugger.sendCommand(
      { tabId: attachedTabId },
      "Accessibility.getFullAXTree",
      { depth: -1 },         // -1 → no limit, full tree
      result => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError.message);
        }
        resolve(result.nodes);  // array of AXNode
      }
    );
  });
}





// 3) Core interceptor + re-emitter
async function interceptAndReplay(originalEvent) {
  // don’t re-intercept our own synthetic events
  if (originalEvent.__isReplayed) return;

  
  // (b) prevent any other handlers from seeing the *original*
  originalEvent.stopImmediatePropagation();
  let eventId =`${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const clone = new originalEvent.constructor(
    originalEvent.type,
    buildEventInit(originalEvent)
  );
  await logEvent("Pre",eventId, clone,originalEvent);
  clone.__isReplayed = true;

  // (d) re-emit on next tick so original default/browser behaviors run first
  setTimeout(async () => {
    originalEvent.target.dispatchEvent(clone);
    // screenshot = chrome.runtime.getBackgroundPage()?.getScreenshot();
    // DOMTree = chrome.runtime.getBackgroundPage()?.getDOMTree();
    // AccessibilityTree = chrome.runtime.getBackgroundPage()?.getAccessibilityTree();
    // BID = chrome.runtime.getBackgroundPage()?.getBID();
      await logEvent("Post",eventId, clone,originalEvent);
  }, 100);
}


async function logEvent(type,eventId, clone,originalEvent) {
  let screenshot = await fetchScreenshotThrottled();
  let DOMTree = document.documentElement.outerHTML;
  let AccessibilityTree ;//= await getAccessibilityTree();
  let BID = null;
  recordEvent(type,eventId, clone,screenshot,DOMTree,AccessibilityTree,BID,originalEvent);
}

// 1) map each Event “class” to the props you actually care about
const EVENT_PROP_MAP = {
  MouseEvent:   ['clientX','clientY','screenX','screenY','button','buttons','ctrlKey','shiftKey','altKey','metaKey'],
  KeyboardEvent:['key','code','repeat','ctrlKey','shiftKey','altKey','metaKey'],
  WheelEvent:   ['deltaX','deltaY','deltaZ','deltaMode'],
  InputEvent:   ['data','inputType','isComposing'],
  FocusEvent:   ['relatedTarget']
};

// 2) one generic builder
function buildEventInit(e) {
  // always grab these three
  const init = {
    bubbles:    e.bubbles,
    cancelable: e.cancelable,
    composed:   e.composed
  };

  // look up extra props by constructor name
  const extras = EVENT_PROP_MAP[e.constructor.name] || [];
  extras.forEach(prop => {
    init[prop] = e[prop];
  });

  return init;
}


/**
 * Need to write a function to store the 
 * intercept { event, xpath , timestamp , screenshot, DOMTree, AccessbilityTree, BID}
 * re-emitted { event, xpath , timestamp , screenshot, DOMTree, AccessbilityTree, BID}
 * 
 */

// Need to write a function to store the intercept
function recordEvent(type, eventId, clone,screenshot,DOMTree,AccessibilityTree,BID,originalEvent) {
  let logObject = {
    type: type,
    eventId: eventId,
    originalEvent: originalEvent,
    clone: clone,
    screenshot: screenshot,
    DOMTree: DOMTree,
    AccessibilityTree: AccessibilityTree,
    BID: BID
  }
  // console.log("recordEvent:: ",logObject);
  chrome.runtime.sendMessage({
    action: "recordEvent",
    event: logObject
  });
  // Get the xpath of the originalEvent
//   const xpath = getXPath(originalEvent.target);
//  chrome.runtime.sendMessage({
//   type: "recordEvent",
//   eventId: eventId,
//   originalEvent: originalEvent,
//   clone: clone,
//   screenshot: screenshot,
//   DOMTree: DOMTree,
//   AccessibilityTree: AccessibilityTree,
//   BID: BID
//  });
  
}

