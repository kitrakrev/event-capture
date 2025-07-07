// Hey there! This is our main event recorder script that captures user interactions on web pages
// We wrap everything in an IIFE (Immediately Invoked Function Expression) 


(function() {
  // Check if we've already initialized to prevent duplicate initialization
  if (window.taskRecorderInitialized) {
    console.log("Recorder already initialized, skipping initialization");
    return;
  }
  
  // Mark as initialized
  window.taskRecorderInitialized = true;
  console.log("Recorder script loaded and initialized");

  // Private variables within this closure
  let events = [];
  let isRecording = false;
  let currentTaskId = null;
  let dynamicObserver = null; // Properly declare the observer variable

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
    if (!element) return false;
    
    const tagName = element.tagName.toLowerCase();
    const role = element.getAttribute('role');
    const type = element.getAttribute('type');
    
    // Check for button-like elements
    const isButton = 
      tagName === 'button' ||
      role === 'button' ||
      type === 'submit' ||
      type === 'button' ||
      element.closest('button') !== null ||
      element.closest('[role="button"]') !== null ||
      element.closest('input[type="submit"]') !== null ||
      element.closest('input[type="button"]') !== null;

    // Check for other interactive elements
    const interactiveTags = ['a', 'input', 'select', 'textarea'];
    const interactiveRoles = ['link', 'checkbox', 'radio', 'textbox', 'combobox', 'listbox', 'menuitem'];
    
    return isButton || 
           interactiveTags.includes(tagName) ||
           interactiveRoles.includes(role) ||
           element.onclick != null ||
           element.getAttribute('tabindex') === '0';
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

  // Function to get stable BID for an element
  function getStableBID(element) {
    // First try to get a stable ID from common attributes
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

    // Fallback: always generate a semantic hash
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

  // Add all click-related event listeners
  const clickEvents = [
    'click',
    'mousedown',
    'mouseup',
    'dblclick',
    'contextmenu',
    'auxclick'
  ];

  clickEvents.forEach(eventType => {
    document.addEventListener(eventType, (event) => {
      const target = event.target;
      const isButton = isInteractiveElement(target);
      
      if (isButton) {
        console.log(`Button click detected:`, {
          type: eventType,
          target: {
            tag: target.tagName,
            id: target.id,
            class: target.className,
            type: target.type,
            role: target.getAttribute('role'),
            text: target.textContent.trim().substring(0, 50)
          },
          timestamp: new Date().toISOString()
        });
      }
      
      recordEvent(event);
    }, true);
  });

  // Handle form submissions
  document.addEventListener('submit', (event) => {
    console.log('Capturing form submission:', {
      target: {
        tag: event.target.tagName,
        id: event.target.id,
        class: event.target.className
      },
      timestamp: new Date().toISOString()
    });
    recordEvent(event);
  }, true);

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

  // Check if we should be recording when script loads
  chrome.storage.local.get(['isRecording', 'currentTaskId', 'taskHistory'], (data) => {
    console.log("Checking recording state:", data);
    if (data.isRecording && data.currentTaskId) {
      isRecording = true;
      currentTaskId = data.currentTaskId;
      
      // Get existing events for this task
      if (data.taskHistory && data.taskHistory[currentTaskId]) {
        events = data.taskHistory[currentTaskId].events || [];
      }
      
      // Initialize recording - but wait for DOM to be ready
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initializeRecording();
      } else {
        document.addEventListener('DOMContentLoaded', initializeRecording);
      }
    }
  });

  // Function to initialize recording (attach event listeners)
  function initializeRecording() {
    console.log("Initializing recording with event listeners");
    
    // Remove existing listeners first
    const eventsToRemove = [
      ['click', recordEvent],
      ['mousedown', recordEvent],
      ['mouseup', recordEvent],
      ['mouseover', recordEvent],
      ['mouseout', recordEvent],
      ['keydown', recordEvent],
      ['keyup', recordEvent],
      ['keypress', recordEvent],
      ['scroll', debouncedRecordScroll],
      ['input', debouncedRecordInput],
      ['focus', recordEvent],
      ['blur', recordEvent],
      ['change', debouncedRecordInput],
      ['submit', recordEvent],
      ['touchstart', recordEvent],
      ['touchend', recordEvent],
      ['touchmove', recordEvent]
    ];

    eventsToRemove.forEach(([event, handler]) => {
      document.removeEventListener(event, handler, true);
    });
    
    // Add event listeners with capture phase
    eventsToRemove.forEach(([event, handler]) => {
      document.addEventListener(event, handler, true);
      console.log(`Added event listener for ${event}`);
    });
    
    // Add navigation event listeners
    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('pushState', handleNavigation);
    window.addEventListener('replaceState', handleNavigation);
    
    // Set up observer for dynamic elements
    dynamicObserver = observeDynamicChanges();

    // Verify recording state
    console.log("Recording initialized with state:", {
      isRecording,
      currentTaskId,
      eventListeners: eventsToRemove.map(([event]) => event)
    });
  }

  // Create debounced version of recordInput with longer delay
  const debouncedRecordInput = debounce((e) => {
    // Only record input events if the value has actually changed
    if (e.target.value !== lastEventData.lastInputValue) {
      recordEvent(e);
    }
  }, 500); // Increased to 500ms debounce

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

  function startRecording(taskId) {
    console.log("Recording started for task:", taskId);
    isRecording = true;
    currentTaskId = taskId;
    
    // Get existing events if any
    chrome.storage.local.get(['taskHistory'], (data) => {
      const taskHistory = data.taskHistory || {};
      if (taskHistory[currentTaskId]) {
        events = taskHistory[currentTaskId].events || [];
      } else {
        events = [];
      }
      
      console.log("Retrieved existing events:", events);
      
      // Initialize recording - but wait for DOM to be ready
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initializeRecording();
      } else {
        document.addEventListener('DOMContentLoaded', initializeRecording);
      }
      
      // Record initial page load as an event
      const pageLoadEvent = {
        type: EVENT_TYPES.PAGE_LOAD,
        timestamp: formatTimestamp(Date.now()),
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
    
    // Remove event listeners
    const eventsToRemove = [
      ['click', recordEvent],
      ['mousedown', recordEvent],
      ['mouseup', recordEvent],
      ['mouseover', recordEvent],
      ['mouseout', recordEvent],
      ['keydown', recordEvent],
      ['keyup', recordEvent],
      ['keypress', recordEvent],
      ['scroll', debouncedRecordScroll],
      ['input', debouncedRecordInput],
      ['focus', recordEvent],
      ['blur', recordEvent],
      ['change', debouncedRecordInput],
      ['submit', recordEvent],
      ['touchstart', recordEvent],
      ['touchend', recordEvent],
      ['touchmove', recordEvent]
    ];

    eventsToRemove.forEach(([event, handler]) => {
      document.removeEventListener(event, handler, true);
    });
    
    // Disconnect observer
    if (dynamicObserver) {
      try {
        dynamicObserver.disconnect();
        dynamicObserver = null;
      } catch (e) {
        console.error("Error disconnecting observer:", e);
      }
    }
    
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

  // Update saveEvents function to store all events without limits
  function saveEvents() {
    if (!isRecording || !currentTaskId) return;
    
    chrome.storage.local.get(['taskHistory'], function(data) {
      const taskHistory = data.taskHistory || {};
      
      if (taskHistory[currentTaskId]) {
        taskHistory[currentTaskId].events = events;
        chrome.storage.local.set({ taskHistory: taskHistory });
      }
    });
  }

  // Add debounced scroll handler
  const debouncedRecordScroll = debounce((e) => {
    recordEvent(e);
  }, 100);

  // Function to handle navigation events
  function handleNavigation(event) {
    if (!isRecording) return;
    
    const currentUrl = window.location.href;
    const previousUrl = navigationState.lastUrl || document.referrer;
    
    if (currentUrl !== previousUrl) {
      recordNavigationEvent(previousUrl, currentUrl);
    }
  }

  // Add beforeunload handler for navigation
  window.addEventListener('beforeunload', function() {
    if (!isRecording) return;
    
    navigationState.pendingNavigation = true;
    const currentUrl = window.location.href;
    
    // Save current state
    try {
      localStorage.setItem('pendingNavigation', JSON.stringify({
        fromUrl: currentUrl,
        timestamp: Date.now(),
        taskId: currentTaskId
      }));
    } catch (e) {
      console.error("Error saving navigation state:", e);
    }
  });

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

  // Update recordEvent function to handle async responses
  async function recordEvent(event) {
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
        a11y: await getA11yIdentifiers(event.target),
        screenshot: (event.type === 'click' || 
                   event.type === 'mousedown' || 
                   event.type === 'mouseup' || 
                   event.type === 'dblclick' || 
                   event.type === 'contextmenu' || 
                   event.type === 'auxclick' || 
                   (event.target.tagName.toLowerCase() === 'button') || 
                   (event.target.getAttribute('role') === 'button') || 
                   (event.target.type === 'submit') || 
                   (event.target.type === 'button') ||
                   (event.target.closest('button') !== null) ||
                   (event.target.closest('[role="button"]') !== null) ||
                   (event.target.closest('input[type="submit"]') !== null) ||
                   (event.target.closest('input[type="button"]') !== null)) ? await new Promise((resolve) => {
          // Send message to background script
          chrome.runtime.sendMessage(
            { 
              action: 'captureScreenshot',
              pageInfo: {
                url: window.location.href,
                protocol: window.location.protocol
              }
            },
            (response) => {
              if (chrome.runtime.lastError) {
                resolve(null);
                return;
              }
              resolve(response?.dataUrl || null);
            }
          );
        }) : null,
        attributes: Array.from(event.target.attributes).reduce((acc, attr) => {
          acc[attr.name] = attr.value;
          return acc;
        }, {}),
        boundingBox: event.target.getBoundingClientRect().toJSON()
      }
    };

    // Add event-specific data
    if (event.type === 'click' || event.type === 'mousedown' || event.type === 'mouseup') {
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
      eventData.detail = event.detail;
    }

    // Send event to background script
    chrome.runtime.sendMessage({
      type: 'recordedEvent',
      event: eventData
    }, (response) => {
      if (!chrome.runtime.lastError) {
        events.push(eventData);
      }
    });
  }
})(); // End of IIFE
