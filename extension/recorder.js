// Content script that captures user interactions on the active page.
//
// Purpose: Attach configurable DOM and navigation listeners to capture
// meaningful user interactions (e.g., clicks, inputs, navigations) and send
// normalized event objects to the background script for persistence.
//
// What it does:
// - Loads `event-config.json` to decide which listeners to attach.
// - Records events with stable element identifiers (CSS, XPath, semantics).
// - Handles navigation and dynamic DOM changes where enabled by config.
// - Streams events to the background via chrome.runtime messaging.

// We wrap everything in an IIFE (Immediately Invoked Function Expression) 


(function() {
  // Allow re-injection for new recording sessions
  // Instead of blocking entirely, we'll check during specific operations
  if (window.taskRecorderInitialized) {
    console.log("Recorder script re-injected, allowing re-initialization");
  } else {
    window.taskRecorderInitialized = true;
    console.log("Recorder script loaded and initialized");
  }

  // Private variables within this closure
  let events = [];
  let isRecording = false;
  let currentTaskId = null;
  let dynamicObserver = null; // Properly declare the observer variable
  let browserGymObserver = null; // Observer for re-marking new DOM elements
  let browserGymRemarkTimeout = null; // Debounce timer for re-marking

  // Add debouncing utility
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Keep track of the last event to avoid duplicates
  const lastEventData = {
    type: null,
    target: null,
    value: null,
    timestamp: 0,
    lastInputValue: null
  };

  // Track page navigation to handle URL changes smoothly
  const navigationState = {
    lastUrl: null,
    lastTitle: null,
    pendingNavigation: false
  };

  // Error recovery system - Dont fail :((
  const recoveryState = {
    lastSavedTimestamp: Date.now(),
    errorCount: 0,
    maxErrors: 3  // We'll try 3 times before giving up
  };

  // All the different types of events we can capture
  // This is like our dictionary of possible user actions
  const EVENT_TYPES = {
    PAGE_LOAD: 'pageLoad',    // When a page first loads
    INPUT: 'input',          // When user types or changes input
    CLICK: 'click',          // Mouse clicks
    NAVIGATION: 'navigation', // Page navigation
    FOCUS: 'focus',          // When an element gets focus
    MOUSE_OVER: 'mouseover', // Mouse hovering over elements
    MOUSE_OUT: 'mouseout',   // Mouse leaving elements
    KEY_DOWN: 'keydown',     // Keyboard key press
    KEY_UP: 'keyup',         // Keyboard key release
    KEY_PRESS: 'keypress',   // Character input
    SCROLL: 'scroll',        // Page scrolling
    SUBMIT: 'submit',        // Form submissions
    CHANGE: 'change',        // Value changes
    BLUR: 'blur',           // Element losing focus
    TOUCH_START: 'touchstart', // Mobile touch start
    TOUCH_END: 'touchend',    // Mobile touch end
    TOUCH_MOVE: 'touchmove'   // Mobile touch movement
  };

  const DEFAULT_EVENT_CONFIG = {
    domEvents: [
      { name: 'click', enabled: true, handler: 'recordEvent' },
      { name: 'mousedown', enabled: true, handler: 'recordEvent' },
      { name: 'mouseup', enabled: true, handler: 'recordEvent' },
      { name: 'mouseover', enabled: true, handler: 'recordEvent' },
      { name: 'mouseout', enabled: true, handler: 'recordEvent' },
      { name: 'keydown', enabled: true, handler: 'recordEvent' },
      { name: 'keyup', enabled: true, handler: 'recordEvent' },
      { name: 'keypress', enabled: true, handler: 'recordEvent' },
      { name: 'scroll', enabled: true, handler: 'debouncedRecordScroll' },
      { name: 'input', enabled: true, handler: 'debouncedRecordInput' },
      { name: 'change', enabled: true, handler: 'debouncedRecordInput' },
      { name: 'focus', enabled: true, handler: 'recordEvent' },
      { name: 'blur', enabled: true, handler: 'recordEvent' },
      { name: 'submit', enabled: true, handler: 'recordEvent' },
      { name: 'touchstart', enabled: true, handler: 'recordEvent' },
      { name: 'touchend', enabled: true, handler: 'recordEvent' },
      { name: 'touchmove', enabled: true, handler: 'recordEvent' }
    ],
    navigationEvents: [
      { name: 'popstate', enabled: true },
      { name: 'pushState', enabled: true },
      { name: 'replaceState', enabled: true },
      { name: 'beforeunload', enabled: true }
    ],
    observers: {
      dynamicDom: true
    }
  };

  let cachedEventConfig = null;
  const activeDomListeners = new Map();
  const activeNavigationListeners = new Map();

  function mergeEventConfig(userConfig) {
    const configClone = JSON.parse(JSON.stringify(DEFAULT_EVENT_CONFIG));

    if (!userConfig) {
      return configClone;
    }

    if (Array.isArray(userConfig.domEvents)) {
      const existingDom = new Map(configClone.domEvents.map(evt => [evt.name, evt]));
      userConfig.domEvents.forEach(evt => {
        if (!evt || !evt.name) {
          return;
        }
        if (existingDom.has(evt.name)) {
          Object.assign(existingDom.get(evt.name), evt);
        } else {
          configClone.domEvents.push(evt);
        }
      });
    }

    if (Array.isArray(userConfig.navigationEvents)) {
      const existingNav = new Map(configClone.navigationEvents.map(evt => [evt.name, evt]));
      userConfig.navigationEvents.forEach(evt => {
        if (!evt || !evt.name) {
          return;
        }
        if (existingNav.has(evt.name)) {
          Object.assign(existingNav.get(evt.name), evt);
        } else {
          configClone.navigationEvents.push(evt);
        }
      });
    }

    if (userConfig.observers && typeof userConfig.observers.dynamicDom === 'boolean') {
      configClone.observers.dynamicDom = userConfig.observers.dynamicDom;
    }

    return configClone;
  }

  async function loadEventConfig() {
    if (cachedEventConfig) {
      return cachedEventConfig;
    }

    try {
      const configUrl = chrome.runtime.getURL('event-config.json');
      const response = await fetch(configUrl, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`Failed to load event-config.json: ${response.status}`);
      }
      const userConfig = await response.json();
      cachedEventConfig = mergeEventConfig(userConfig);
    } catch (error) {
      console.warn('Falling back to default event configuration.', error);
      cachedEventConfig = mergeEventConfig(null);
    }

    return cachedEventConfig;
  }

  const debouncedRecordInput = debounce((e) => {
    if (e.target.value !== lastEventData.lastInputValue) {
      recordEvent(e);
    }
  }, 500);

  const debouncedRecordScroll = debounce((e) => {
    recordEvent(e);
  }, 100);

  // Track click behavior to handle double-clicks and rapid clicks
  const clickState = {
    lastClickTime: 0,
    lastClickTarget: null,
    clickCount: 0
  };

  // Verify that our event capture is working correctly
  const eventVerification = {
    clicks: [],
    inputs: [],
    navigations: [],
    lastEventTime: 0
  };

  // Test mode settings for debugging and validation
  const testMode = {
    enabled: true,
    validationQueue: [],
    lastValidationTime: 0,
    validationInterval: 1000, // Check every second
    maxQueueSize: 100        // Don't let the queue get too big
  };

  // Format timestamps in a consistent way
  function formatTimestamp(timestamp) {
    return new Date(timestamp).toISOString();
  }

  // This function helps us decide if we should ignore an event
  // We don't want to record every tiny movement or duplicate actions
  function shouldIgnoreEvent(event, type) {
    const element = event.target;
    const currentValue = element.value || '';
    const currentTime = Date.now();
    
    // Special handling for clicks - we want to be smart about what clicks we record
    if (type === EVENT_TYPES.CLICK || type === 'mouseup') {
        // Ignore super quick double-clicks (less than 25ms apart)
        if (currentTime - clickState.lastClickTime < 25 && 
            element === clickState.lastClickTarget) {
            return true;
        }

        // Remember this click for next time
        clickState.lastClickTime = currentTime;
        clickState.lastClickTarget = element;
        clickState.clickCount++;
        
        // Log what we clicked on - helpful for debugging
        console.log(`Click detected on:`, {
            element: element.tagName,
            id: element.id,
            class: element.className,
            text: element.textContent.trim().substring(0, 50),
            clickCount: clickState.clickCount,
            type: type,
            timestamp: new Date(currentTime).toISOString(),
            button: event.button,  // Which mouse button was used
            buttons: event.buttons // State of all mouse buttons
        });

        // Always record clicks on interactive elements (buttons, links, etc.)
        if (isInteractiveElement(element)) {
            return false;
        }
    }
    
    // Handle input events - we only care about actual changes
    if (type === EVENT_TYPES.INPUT) {
        // Skip if the value hasn't changed
        console.log('attempting to log input')
        if (currentValue === lastEventData.lastInputValue) {
            return true;
        }
        // Remember this value for next time
        lastEventData.lastInputValue = currentValue;
    }

    // Handle scroll events - we only care about significant scrolling
    if (type === EVENT_TYPES.SCROLL) {
        const scrollThreshold = 50; // pixels
        if (Math.abs(event.deltaY) < scrollThreshold) {
            return true; // Ignore tiny scrolls
        }
    }

    // Handle mouse hover events - only record for interactive elements or tooltips
    if (type === EVENT_TYPES.MOUSE_OVER || type === EVENT_TYPES.MOUSE_OUT) {
        if (!isInteractiveElement(element) && !element.hasAttribute('title')) {
            return true; // Ignore hovering over regular text
        }
    }

    // Check for duplicate events within a short time window
    if (lastEventData.type === type && 
        lastEventData.target === element && 
        currentTime - lastEventData.timestamp < 300) {
        return true; // Ignore duplicates within 300ms
    }
    
    // Update our memory of the last event
    lastEventData.type = type;
    lastEventData.target = element;
    lastEventData.value = currentValue;
    lastEventData.timestamp = currentTime;
    
    return false;
  }

  // Helper to identify interactive elements that users can click or interact with
  function isInteractiveElement(element) {
    const interactiveTags = ['button', 'input', 'select', 'textarea', 'a'];
    const interactiveRoles = ['button', 'link', 'checkbox', 'radio', 'textbox', 'combobox', 'listbox', 'menuitem'];
    
    return (
      interactiveTags.includes(element.tagName.toLowerCase()) ||
      interactiveRoles.includes(element.getAttribute('role')) ||
      element.onclick != null ||
      element.getAttribute('tabindex') === '0'
    );
  }

  // Quick check for images and links
  function isImageOrLink(element) {
    return element.tagName.toLowerCase() === 'img' || element.tagName.toLowerCase() === 'a';
  }

  // Get a CSS selector path to uniquely identify an element
  // This helps us find elements again later, even if the page changes
  function getElementCssPath(element) {
    if (!element || element.nodeType !== 1) return '';
    
    let path = [];
    while (element && element.nodeType === 1) {
      let selector = element.tagName.toLowerCase();
      
      // If element has an ID, we can stop here - IDs are unique!
      if (element.id) {
        selector += '#' + element.id;
        path.unshift(selector);
        break;
      } else {
        // Add classes to make the selector more specific
        if (element.className && typeof element.className === 'string') {
          const classes = element.className.split(/\s+/).filter(c => c);
          if (classes.length > 0) {
            selector += '.' + classes.join('.');
          }
        }
        
        // Add position information if there are similar siblings
        let sibling = element, index = 1;
        while (sibling = sibling.previousElementSibling) {
          if (sibling.tagName === element.tagName) index++;
        }
        if (index > 1) selector += ':nth-of-type(' + index + ')';
        
        path.unshift(selector);
        element = element.parentNode;
      }
      
      // Keep the path reasonably short
      if (path.length > 5) break;
    }
    
    return path.join(' > ');
  }

  // Utility function to get element XPath
  function getElementXPath(element) {
    if (!element || element.nodeType !== 1) return '';
    
    if (element.id !== '') {
      return `//*[@id="${element.id}"]`;
    }
    
    if (element === document.body) {
      return '/html/body';
    }
    
    let ix = 0;
    const siblings = element.parentNode.childNodes;
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling === element) {
        return getElementXPath(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
      }
      if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
        ix++;
      }
    }
  }

  // Function to get stable BID for an element (BrowserGym)
  function getStableBID(element) {
    // First try to get BrowserGym injected BID
    if (element.hasAttribute('data-bid')) {
      return element.getAttribute('data-bid');
    }

    // Fallback: try common attributes
    const attributes = [
      { attr: 'data-testid', prefix: 'test-' },
      { attr: 'aria-label', prefix: 'aria-' },
      { attr: 'id', prefix: 'id-' },
      { attr: 'name', prefix: 'name-' },
      { attr: 'placeholder', prefix: 'place-' },
      { attr: 'alt', prefix: 'alt-' },
      { attr: 'title', prefix: 'title-' },
      { attr: 'role', prefix: 'role-' }
    ];

    for (const { attr, prefix } of attributes) {
      const value = element.getAttribute(attr);
      if (value) {
        return prefix + value.toLowerCase().replace(/[^a-z0-9]/g, '-');
      }
    }

    // Last fallback: generate a semantic hash
    const tag = element.tagName.toLowerCase();
    const classes = element.className && typeof element.className === 'string'
      ? element.className.split(/\s+/).filter(c => c).join('-')
      : '';
    const text = element.textContent ? element.textContent.trim().substring(0, 30) : '';
    const siblings = Array.from(element.parentNode?.children || []);
    const index = siblings.indexOf(element);
    const semanticId = `${tag}-${classes}-${text}-${index}`;
    const hash = hashString(semanticId);
    return `${tag}${classes ? '-' + classes : ''}-${hash}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }

  // Enhanced hash function for better uniqueness
  function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    // Convert to base36 and take first 6 characters
    return (hash >>> 0).toString(36).substring(0, 6);
  }

  // Function to verify and log event capture
  function verifyEventCapture(event, type) {
    const currentTime = Date.now();
    const element = event.target;
    
    // Enhanced logging for click events
    if (type === EVENT_TYPES.CLICK) {
        console.log(`Click verification:`, {
            type: type,
            element: {
                tag: element.tagName,
                id: element.id,
                class: element.className,
                text: element.textContent.trim().substring(0, 50),
                value: element.value || '',
                isInteractive: isInteractiveElement(element)
            },
            time: new Date(currentTime).toISOString(),
            url: window.location.href,
            clickCount: clickState.clickCount
        });
    } else {
        // Log all other events for verification
        console.log(`Event detected:`, {
            type: type,
            element: {
                tag: element.tagName,
                id: element.id,
                class: element.className,
                text: element.textContent.trim().substring(0, 50),
                value: element.value || ''
            },
            time: new Date(currentTime).toISOString(),
            url: window.location.href
        });
    }

    // Track different event types
    switch(type) {
        case EVENT_TYPES.CLICK:
            eventVerification.clicks.push({
                time: currentTime,
                element: {
                    tag: element.tagName,
                    id: element.id,
                    text: element.textContent.trim().substring(0, 50),
                    isInteractive: isInteractiveElement(element)
                },
                url: window.location.href
            });
            break;
        case EVENT_TYPES.INPUT:
            eventVerification.inputs.push({
                time: currentTime,
                element: {
                    tag: element.tagName,
                    id: element.id,
                    value: element.value
                }
            });
            break;
        case EVENT_TYPES.NAVIGATION:
            eventVerification.navigations.push({
                time: currentTime,
                fromUrl: navigationState.lastUrl,
                toUrl: window.location.href
            });
            break;
    }

    // Log verification state periodically
    if (currentTime - eventVerification.lastEventTime > 1000) {
        console.log('Event Capture Verification:', {
            totalClicks: eventVerification.clicks.length,
            totalInputs: eventVerification.inputs.length,
            totalNavigations: eventVerification.navigations.length,
            lastMinute: {
                clicks: eventVerification.clicks.filter(c => currentTime - c.time < 60000).length,
                inputs: eventVerification.inputs.filter(i => currentTime - i.time < 60000).length,
                navigations: eventVerification.navigations.filter(n => currentTime - n.time < 60000).length
            },
            clickState: {
                lastClickTime: new Date(clickState.lastClickTime).toISOString(),
                clickCount: clickState.clickCount
            }
        });
        eventVerification.lastEventTime = currentTime;
    }
  }

  // Function to validate event capture
  function validateEventCapture(event, type) {
    if (!testMode.enabled) return;

    const validation = {
      timestamp: Date.now(),
      type: type,
      element: {
        tag: event.target.tagName,
        id: event.target.id,
        class: event.target.className,
        text: event.target.textContent.trim().substring(0, 50),
        value: event.target.value || ''
      },
      url: window.location.href,
      verified: false
    };

    // Add to validation queue
    testMode.validationQueue.push(validation);
    if (testMode.validationQueue.length > testMode.maxQueueSize) {
      testMode.validationQueue.shift(); // Remove oldest
    }

    // Log validation attempt
    console.log(`Event validation attempt:`, validation);

    // Verify against recorded events
    const matchingEvent = events.find(e => 
      e.timestamp === formatTimestamp(validation.timestamp) &&
      e.type === validation.type &&
      e.url === validation.url
    );

    if (matchingEvent) {
      validation.verified = true;
      console.log(`Event validation SUCCESS:`, {
        type: validation.type,
        element: validation.element,
        timestamp: validation.timestamp
      });
    } else {
      console.warn(`Event validation FAILED:`, {
        type: validation.type,
        element: validation.element,
        timestamp: validation.timestamp
      });
    }

    return validation.verified;
  }

  // Enhanced function to record an event
  function recordEvent(event) {
    if (!isRecording) return;
    
    // Create event object with BrowserGym-like structure
    const eventData = {
      type: event.type,
      timestamp: Date.now(),
      url: window.location.href,
      target: {
        tag: event.target.tagName,
        id: event.target.id,
        class: event.target.className,
        text: event.target.textContent,
        value: event.target.value,
        isInteractive: isInteractiveElement(event.target),
        xpath: getElementXPath(event.target),
        cssPath: getElementCssPath(event.target),
        bid: getStableBID(event.target),
        a11y: getA11yIdentifiers(event.target),
        attributes: Array.from(event.target.attributes).reduce((acc, attr) => {
          acc[attr.name] = attr.value;
          return acc;
        }, {}),
        boundingBox: event.target.getBoundingClientRect().toJSON(),
        // BrowserGym-specific attributes
        browsergym_set_of_marks: event.target.getAttribute('browsergym_set_of_marks') || null,
        browsergym_visibility_ratio: event.target.getAttribute('browsergym_visibility_ratio') || null
      }
    };

    // Add event-specific data
    if (event.type === 'click') {
      eventData.button = event.button;
      eventData.buttons = event.buttons;
      eventData.clientX = event.clientX;
      eventData.clientY = event.clientY;
      eventData.screenX = event.screenX;
      eventData.screenY = event.screenY;
      eventData.pageX = event.pageX;
      eventData.pageY = event.pageY;
      eventData.offsetX = event.offsetX;
      eventData.offsetY = event.offsetY;
      eventData.movementX = event.movementX;
      eventData.movementY = event.movementY;
      eventData.ctrlKey = event.ctrlKey;
      eventData.altKey = event.altKey;
      eventData.shiftKey = event.shiftKey;
      eventData.metaKey = event.metaKey;
      eventData.detail = event.detail; // For double clicks
    }

    // Send event to background script
    chrome.runtime.sendMessage({ type: 'recordedEvent', event: eventData });

    // Also store locally for verification
    events.push(eventData);

    // Log click events for debugging
    if (event.type === 'click') {
      console.log('Click recorded:', {
        type: event.type,
        target: {
          tag: event.target.tagName,
          id: event.target.id,
          class: event.target.className,
          text: event.target.textContent.trim().substring(0, 50),
          isInteractive: isInteractiveElement(event.target),
          bid: eventData.target.bid
        },
        position: {
          client: { x: event.clientX, y: event.clientY },
          screen: { x: event.screenX, y: event.screenY },
          page: { x: event.pageX, y: event.pageY }
        },
        buttons: {
          button: event.button,
          buttons: event.buttons,
          detail: event.detail
        },
        modifiers: {
          ctrl: event.ctrlKey,
          alt: event.altKey,
          shift: event.shiftKey,
          meta: event.metaKey
        },
        timestamp: new Date(eventData.timestamp).toISOString()
      });
    }
  }

  // Simple function to get accessibility identifiers for an element
  function getA11yIdentifiers(element) {
    if (!element) return {};
    
    return {
      // Role is the most important identifier in the a11y tree
      role: element.getAttribute('role') || getImplicitRole(element),
      
      // Name is how the element is announced (crucial for identification)
      name: getAccessibleName(element),
      
      // Basic path through the a11y tree (for locating in the tree)
      path: getSimpleA11yPath(element),
      
      // Additional identifiers that help locate the element
      id: element.id || '',
      tagName: element.tagName.toLowerCase()
    };
  }

  // Get a simple path through the accessibility tree
  function getSimpleA11yPath(element) {
    if (!element) return '';
    
    const path = [];
    let current = element;
    let depth = 0;
    const MAX_DEPTH = 5; // Limit path depth to avoid excessive length
    
    while (current && current.nodeType === 1 && depth < MAX_DEPTH) {
      const role = current.getAttribute('role') || getImplicitRole(current);
      const name = getAccessibleName(current);
      
      let pathSegment = role || current.tagName.toLowerCase();
      if (name) {
        // Include name but keep it short
        const shortName = name.length > 25 ? name.substring(0, 25) + '...' : name;
        pathSegment += `[${shortName}]`;
      }
      
      path.unshift(pathSegment);
      current = current.parentElement;
      depth++;
    }
    
    return path.join(' > ');
  }

  // Simple function to get accessible name
  function getAccessibleName(element) {
    // Check common name sources in priority order
    return element.getAttribute('aria-label') || 
           element.getAttribute('alt') || 
           element.getAttribute('title') || 
           element.textContent.trim().substring(0, 50) || '';
  }

  // Simple function to determine implicit role
  function getImplicitRole(element) {
    const tagName = element.tagName.toLowerCase();
    
    // Very simplified mapping of common elements to roles
    const simpleRoleMap = {
      'a': 'link',
      'button': 'button',
      'h1': 'heading',
      'h2': 'heading',
      'h3': 'heading',
      'input': 'textbox',
      'select': 'combobox',
      'textarea': 'textbox',
      'img': 'img',
      'ul': 'list',
      'ol': 'list',
      'li': 'listitem'
    };
    
    return simpleRoleMap[tagName] || '';
  }

  // Function to re-mark DOM elements with BrowserGym (for dynamically added content)
  // Uses event-based communication to avoid CSP violations
  function remarkWithBrowserGym() {
    try {
      // Dispatch a custom event that browsergym-inject.js will listen for
      // This avoids CSP violations since we're not injecting inline scripts
      document.dispatchEvent(new CustomEvent('browsergym-remark-request', {
        detail: { timestamp: Date.now() }
      }));
      console.log('📤 Sent re-mark request to BrowserGym');
    } catch (err) {
      console.error('Failed to trigger BrowserGym re-marking:', err);
    }
  }

  // Debounced version of remarkWithBrowserGym to avoid excessive calls
  const debouncedRemark = debounce(remarkWithBrowserGym, 500);

  // Start observing DOM mutations for BrowserGym re-marking
  function startBrowserGymObserver() {
    // Stop existing observer if any
    if (browserGymObserver) {
      browserGymObserver.disconnect();
    }

    browserGymObserver = new MutationObserver((mutations) => {
      // Check if any mutations added new elements
      const hasNewElements = mutations.some(mutation => 
        mutation.type === 'childList' && mutation.addedNodes.length > 0
      );

      if (hasNewElements && isRecording) {
        console.log('🔍 New DOM elements detected, scheduling re-mark...');
        debouncedRemark();
      }
    });

    // Observe the entire document for new elements
    browserGymObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('👁️ BrowserGym MutationObserver started');
  }

  // Stop observing DOM mutations
  function stopBrowserGymObserver() {
    if (browserGymObserver) {
      browserGymObserver.disconnect();
      browserGymObserver = null;
      console.log('👁️ BrowserGym MutationObserver stopped');
    }
  }

  // Unified initialization function for both new recordings and resumed sessions
  async function initializeRecordingSession(taskId, options = {}) {
    const {
      isResuming = false,           // true if resuming after navigation, false if new recording
      existingEvents = [],          // events from storage (for resumed sessions)
      clearCache = false            // whether to clear cached config
    } = options;

    console.log(`Initializing recording session: ${isResuming ? 'RESUMED' : 'NEW'}`, { taskId });

    // Set recording state
    isRecording = true;
    currentTaskId = taskId;
    events = existingEvents;

    if (clearCache) {
      cachedEventConfig = null;
    }

    // Initialize event listeners immediately
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      initializeRecording();
    } else {
      document.addEventListener('DOMContentLoaded', initializeRecording);
    }

    // CAPTURE HTML FOR EVERY PAGE LOAD (new or resumed)
    const pageTimestamp = Date.now();
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      capturePageHTML(pageTimestamp);
      captureAxTree(pageTimestamp);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        capturePageHTML(pageTimestamp);
        captureAxTree(pageTimestamp);
      }, { once: true });
    }

    // Inject BrowserGym script asynchronously (doesn't block event capture)
    (async () => {
      try {
        console.log(`Injecting BrowserGym BID system (${isResuming ? 'resumed' : 'new'})...`);
        const success = await injectBrowserGymScript();
        if (success) {
          console.log('✅ BrowserGym BID injection complete');
          // Start observing DOM for dynamic content after initial marking
          startBrowserGymObserver();
        } else {
          console.warn('⚠️ BrowserGym BID injection completed with warnings');
          // Still start observer even with warnings
          startBrowserGymObserver();
        }
      } catch (err) {
        console.error('❌ BrowserGym injection failed:', err);
        // Continue recording with fallback BIDs, but don't start observer
      }
    })();

    // Record page load event for resumed sessions (after navigation)
    if (isResuming) {
      const pageLoadEvent = {
        type: EVENT_TYPES.PAGE_LOAD,
        timestamp: Date.now(),
        url: window.location.href,
        title: document.title
      };
      events.push(pageLoadEvent);
      saveEvents();
    }
  }

  // Check if we should be recording when script loads (handles navigation during recording)
  chrome.storage.local.get(['isRecording', 'currentTaskId', 'taskHistory'], (data) => {
    console.log("Checking recording state:", data);
    if (data.isRecording && data.currentTaskId) {
      // Get existing events for this task
      const existingEvents = (data.taskHistory && data.taskHistory[data.currentTaskId]) 
        ? (data.taskHistory[data.currentTaskId].events || [])
        : [];
      
      // Resume recording session
      initializeRecordingSession(data.currentTaskId, {
        isResuming: true,
        existingEvents: existingEvents,
        clearCache: false
      });
    }
  });

  function getHandlerByKey(handlerKey) {
    switch (handlerKey) {
      case 'debouncedRecordInput':
        return debouncedRecordInput;
      case 'debouncedRecordScroll':
        return debouncedRecordScroll;
      case 'recordEvent':
      default:
        return recordEvent;
    }
  }

  function detachDomListeners() {
    activeDomListeners.forEach((handler, eventName) => {
      document.removeEventListener(eventName, handler, true);
    });
    activeDomListeners.clear();
  }

  function detachNavigationListeners() {
    activeNavigationListeners.forEach(({ handler, options }, eventName) => {
      window.removeEventListener(eventName, handler, options);
    });
    activeNavigationListeners.clear();
  }

  const NAVIGATION_HANDLER_MAP = {
    popstate: handleNavigation,
    pushState: handleNavigation,
    replaceState: handleNavigation,
    beforeunload: handleBeforeUnload
  };

  async function initializeRecording() {
    console.log('Initializing recording with configurable listeners');

    try {
      const config = await loadEventConfig();

      detachDomListeners();
      detachNavigationListeners();

      const enabledDomEvents = (config.domEvents || []).filter(evt => evt && evt.enabled !== false);
      enabledDomEvents.forEach(({ name, handler }) => {
        const resolvedHandler = getHandlerByKey(handler);
        if (!resolvedHandler) {
          console.warn(`No handler resolved for event '${name}' (key: ${handler}).`);
          return;
        }
        document.addEventListener(name, resolvedHandler, true);
        activeDomListeners.set(name, resolvedHandler);
        console.log(`Added event listener for ${name}`);
      });

      const enabledNavigationEvents = (config.navigationEvents || []).filter(evt => evt && evt.enabled !== false);
      console.log('🔧 Enabled navigation events:', enabledNavigationEvents);
      enabledNavigationEvents.forEach(({ name }) => {
        const handler = NAVIGATION_HANDLER_MAP[name];
        if (!handler) {
          console.warn(`No navigation handler mapped for ${name}`);
          return;
        }
        const listenerOptions = name === 'beforeunload' ? false : true;
        window.addEventListener(name, handler, listenerOptions);
        activeNavigationListeners.set(name, { handler, options: listenerOptions });
      });

      if (config.observers && config.observers.dynamicDom === false) {
        if (dynamicObserver) {
          dynamicObserver.disconnect();
          dynamicObserver = null;
        }
      } else {
        if (dynamicObserver) {
          dynamicObserver.disconnect();
        }
        dynamicObserver = observeDynamicChanges();
      }

      navigationState.lastUrl = window.location.href;
      navigationState.lastTitle = document.title;

      console.log('Recording initialized with state:', {
        isRecording,
        currentTaskId,
        domEvents: enabledDomEvents.map(evt => evt.name),
        navigationEvents: enabledNavigationEvents.map(evt => evt.name)
      });
    } catch (error) {
      console.error('Failed to initialize recording configuration:', error);
    }
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Message received in recorder:", message);
    if (message.action === "startRecording") {
      startRecording(message.taskId);
      sendResponse({status: "recording started"});
    } else if (message.action === "stopRecording") {
      stopRecording();
      sendResponse({status: "recording stopped"});
    }
    return true; // Required for async sendResponse
  });

  async function injectBrowserGymScript() {
    return new Promise((resolve) => {
      try {
        // Check if already injected
        const existingScript = document.getElementById('browsergym-inject-script');
        if (existingScript) {
          console.log('BrowserGym script already injected');
          resolve(true);
          return;
        }

        // Listen for completion event from injected script
        const completionHandler = (event) => {
          console.log('BrowserGym injection complete:', event.detail);
          clearTimeout(timeoutId);
          resolve(event.detail.success);
        };
        document.addEventListener('browsergym-injection-complete', completionHandler, { once: true });

        // Timeout after 3 seconds
        const timeoutId = setTimeout(() => {
          document.removeEventListener('browsergym-injection-complete', completionHandler);
          console.warn('BrowserGym injection timeout');
          resolve(false);
        }, 3000);

        // Inject the BrowserGym script into page context
        const script = document.createElement('script');
        script.id = 'browsergym-inject-script';
        script.src = chrome.runtime.getURL('browsergym-inject.js');
        script.onload = () => {
          console.log('BrowserGym script loaded');
        };
        script.onerror = () => {
          clearTimeout(timeoutId);
          document.removeEventListener('browsergym-injection-complete', completionHandler);
          console.error('Failed to inject BrowserGym script');
          resolve(false);
        };
        (document.head || document.documentElement).appendChild(script);
      } catch (err) {
        console.error('BrowserGym injection error:', err);
        resolve(false);
      }
    });
  }

  function startRecording(taskId) {
    console.log("Recording started for task:", taskId);
    
    // Get existing events from storage and initialize session
    chrome.storage.local.get(['taskHistory'], (data) => {
      const taskHistory = data.taskHistory || {};
      const existingEvents = taskHistory[taskId] ? (taskHistory[taskId].events || []) : [];
      
      console.log("Retrieved existing events:", existingEvents);
      
      // Use unified initialization function
      initializeRecordingSession(taskId, {
        isResuming: false,
        existingEvents: existingEvents,
        clearCache: true  // Clear config cache for new recordings
      });
      
      // Record initial page load as an event (for new recordings)
      const pageLoadEvent = {
        type: EVENT_TYPES.PAGE_LOAD,
        timestamp: Date.now(),
        url: window.location.href,
        title: document.title
      };
      events.push(pageLoadEvent);
      saveEvents();
    });
  }

  function stopRecording() {
    console.log("Recording stopped");
    isRecording = false;
    
    // Remove event listeners configured for this session
    detachDomListeners();
    detachNavigationListeners();
    
    // Disconnect observers
    if (dynamicObserver) {
      try {
        dynamicObserver.disconnect();
        dynamicObserver = null;
      } catch (e) {
        console.error("Error disconnecting observer:", e);
      }
    }
    
    // Stop BrowserGym observer
    stopBrowserGymObserver();
    
    // Log recorded events
    console.log("Recorded events to save:", events);
    
    // Save the events to the task history
    if (currentTaskId) {
      chrome.storage.local.get(['taskHistory'], function(data) {
        const taskHistory = data.taskHistory || {};
        
        if (taskHistory[currentTaskId]) {
          taskHistory[currentTaskId].events = events;
          
          // Save the updated task history
          chrome.storage.local.set({ taskHistory: taskHistory }, function() {
            console.log("Events saved to task history");
          });
        }
      });
    }
    
    currentTaskId = null;
  }

  function saveEvents() {
    if (!isRecording || !currentTaskId) return;
    
    try {
      chrome.storage.local.get(['taskHistory'], function(data) {
        const taskHistory = data.taskHistory || {};
        
        if (taskHistory[currentTaskId]) {
          taskHistory[currentTaskId].events = events;
          
          // Save the updated task history
          chrome.storage.local.set({ taskHistory: taskHistory }, function() {
            console.log("Events saved to task history");
            recoveryState.lastSavedTimestamp = Date.now();
            recoveryState.errorCount = 0;
          });
        }
      });
    } catch (error) {
      console.error("Error saving events:", error);
      recoveryState.errorCount++;
      
      // Attempt recovery if we've hit too many errors
      if (recoveryState.errorCount >= recoveryState.maxErrors) {
        attemptRecovery();
      }
    }
  }

  function capturePageHTML(navigationTimestamp) {
    if (!isRecording) return;
    
    const htmlData = {
      type: 'htmlSnapshot',
      navigationTimestamp: navigationTimestamp,  // When navigation started
      captureTimestamp: Date.now(),              // When HTML actually captured
      url: window.location.href,
      title: document.title,
      html: document.documentElement.outerHTML,
      characterSet: document.characterSet,
      readyState: document.readyState
    };
    
    // Send to background script for storage
    chrome.runtime.sendMessage({ 
      type: 'capturedHTML', 
      data: htmlData 
    });
    
    console.log('HTML captured for:', window.location.href);
  }

    function captureAxTree(navigationTimestamp) {
    if (!isRecording) return;
    
    const axTreeRequestData = {
      navigationTimestamp: navigationTimestamp,
      captureTimestamp: Date.now(),
      url: window.location.href,
      title: document.title
    };
    
    chrome.runtime.sendMessage({ 
      type: 'requestAxTree', 
      data: axTreeRequestData 
    });
    
    console.log('Accessibility tree capture requested for:', window.location.href);
  }
  

  // Function to handle navigation events
  function handleNavigation(event) {
    if (!isRecording) return;
    
    const currentUrl = window.location.href;
    const previousUrl = navigationState.lastUrl || document.referrer;
    
    if (currentUrl !== previousUrl) {
      recordNavigationEvent(previousUrl, currentUrl);
    }
  }

  function handleBeforeUnload() {
    if (!isRecording) return;

    navigationState.pendingNavigation = true;
    const currentUrl = window.location.href;

    try {
      localStorage.setItem('pendingNavigation', JSON.stringify({
        fromUrl: currentUrl,
        timestamp: Date.now(),
        taskId: currentTaskId
      }));
    } catch (e) {
      console.error('Error saving navigation state:', e);
    }
  }

  // Function to attempt recovery from errors
  function attemptRecovery() {
    console.log("Attempting recovery from errors...");
    
    // Clear error count
    recoveryState.errorCount = 0;
    
    // Try to save events to localStorage as backup
    try {
      localStorage.setItem('eventCaptureBackup', JSON.stringify({
        events: events,
        timestamp: Date.now(),
        taskId: currentTaskId
      }));
    } catch (e) {
      console.error("Failed to create backup:", e);
    }
    
    // Reinitialize recording
    initializeRecording();
  }

  // Enhanced function to record navigation events
  function recordNavigationEvent(fromUrl, toUrl, type = EVENT_TYPES.NAVIGATION) {
    if (!isRecording) return;

    const eventData = {
      type: type,
      timestamp: formatTimestamp(Date.now()),
      fromUrl: fromUrl,
      toUrl: toUrl,
      title: document.title,
      referrer: document.referrer,
      fromUserInput: clickState.clickCount > 0
    };

    events.push(eventData);
    saveEvents();
    
    // Update navigation state
    navigationState.lastUrl = toUrl;
    navigationState.lastTitle = document.title;
    navigationState.pendingNavigation = false;
    
    // Reset click count after navigation
    clickState.clickCount = 0;

    // Log navigation event
    console.log(`Navigation recorded:`, {
      from: fromUrl,
      to: toUrl,
      userInitiated: clickState.clickCount > 0,
      totalNavigations: eventVerification.navigations.length
    });
  }

  // Add periodic event verification
  setInterval(() => {
    if (isRecording) {
      console.log('Event Capture Status:', {
        totalEvents: events.length,
        clicks: eventVerification.clicks.length,
        inputs: eventVerification.inputs.length,
        navigations: eventVerification.navigations.length,
        lastMinute: {
          clicks: eventVerification.clicks.filter(c => Date.now() - c.time < 60000).length,
          inputs: eventVerification.inputs.filter(i => Date.now() - i.time < 60000).length,
          navigations: eventVerification.navigations.filter(n => Date.now() - n.time < 60000).length
        }
      });
    }
  }, 5000);

  // Add periodic validation check
  setInterval(() => {
    if (isRecording && testMode.enabled) {
      const currentTime = Date.now();
      if (currentTime - testMode.lastValidationTime >= testMode.validationInterval) {
        // Check validation queue
        const unverified = testMode.validationQueue.filter(v => !v.verified);
        if (unverified.length > 0) {
          console.warn(`Found ${unverified.length} unverified events:`, unverified);
        }
        
        // Log validation statistics
        console.log('Event Capture Validation Status:', {
          totalEvents: events.length,
          validationQueueSize: testMode.validationQueue.length,
          verifiedEvents: testMode.validationQueue.filter(v => v.verified).length,
          unverifiedEvents: unverified.length,
          lastMinute: {
            total: testMode.validationQueue.filter(v => currentTime - v.timestamp < 60000).length,
            verified: testMode.validationQueue.filter(v => v.verified && currentTime - v.timestamp < 60000).length
          }
        });
        
        testMode.lastValidationTime = currentTime;
      }
    }
  }, 1000);

  // Add periodic recording state verification
  setInterval(() => {
    if (isRecording) {
      console.log('Recording State Check:', {
        isRecording,
        currentTaskId,
        totalEvents: events.length,
        lastEventTime: events.length > 0 ? events[events.length - 1].timestamp : null,
        clickCount: clickState.clickCount,
        eventListeners: {
          click: document.onclick !== null,
          mousedown: document.onmousedown !== null,
          mouseup: document.onmouseup !== null
        }
      });
    }
  }, 2000);

  // Add click event verification
  document.addEventListener('click', function verifyClick(e) {
    if (isRecording) {
      console.log('Click Verification:', {
        target: e.target.tagName,
        id: e.target.id,
        class: e.target.className,
        isInteractive: isInteractiveElement(e.target),
        recordingState: {
          isRecording,
          currentTaskId,
          clickCount: clickState.clickCount
        }
      });
    }
  }, true);
})(); // End of IIFE
