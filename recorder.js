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

  // Add performance tracking utilities at the top of the file
  const performanceMetrics = {
    startTime: Date.now(),
    events: {
      total: 0,
      byType: {},
      processingTimes: []
    },
    memory: {
      samples: [],
      lastSample: null
    },
    mutations: {
      total: 0,
      byType: {},
      processingTimes: []
    }
  };

  // Function to track memory usage
  function trackMemoryUsage() {
    if (window.performance && window.performance.memory) {
      const memory = window.performance.memory;
      const sample = {
        timestamp: Date.now(),
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit
      };
      
      performanceMetrics.memory.samples.push(sample);
      performanceMetrics.memory.lastSample = sample;
      
      // Keep only last 100 samples
      if (performanceMetrics.memory.samples.length > 100) {
        performanceMetrics.memory.samples.shift();
      }
      
      console.log('Memory Usage:', {
        used: formatBytes(sample.usedJSHeapSize),
        total: formatBytes(sample.totalJSHeapSize),
        limit: formatBytes(sample.jsHeapSizeLimit),
        percentage: ((sample.usedJSHeapSize / sample.totalJSHeapSize) * 100).toFixed(2) + '%'
      });
    }
  }

  // Utility to format bytes
  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Function to track event timing
  function trackEventTiming(eventType, startTime) {
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    performanceMetrics.events.processingTimes.push({
      type: eventType,
      duration,
      timestamp: Date.now()
    });
    
    // Keep only last 1000 timing samples
    if (performanceMetrics.events.processingTimes.length > 1000) {
      performanceMetrics.events.processingTimes.shift();
    }
    
    // Update event counts
    performanceMetrics.events.total++;
    performanceMetrics.events.byType[eventType] = (performanceMetrics.events.byType[eventType] || 0) + 1;
    
    return duration;
  }

  // Function to log performance metrics
  function logPerformanceMetrics() {
    const now = Date.now();
    const uptime = now - performanceMetrics.startTime;
    
    // Calculate average processing times
    const avgProcessingTime = performanceMetrics.events.processingTimes.reduce((acc, curr) => acc + curr.duration, 0) / 
                             performanceMetrics.events.processingTimes.length;
    
    // Calculate event rates
    const eventsPerSecond = performanceMetrics.events.total / (uptime / 1000);
    
    console.log('Performance Metrics:', {
      uptime: formatDuration(uptime),
      events: {
        total: performanceMetrics.events.total,
        byType: performanceMetrics.events.byType,
        rate: eventsPerSecond.toFixed(2) + ' events/sec',
        avgProcessingTime: avgProcessingTime.toFixed(2) + 'ms'
      },
      mutations: {
        total: performanceMetrics.mutations.total,
        byType: performanceMetrics.mutations.byType,
        avgProcessingTime: performanceMetrics.mutations.processingTimes.length > 0 ?
          (performanceMetrics.mutations.processingTimes.reduce((acc, curr) => acc + curr, 0) / 
           performanceMetrics.mutations.processingTimes.length).toFixed(2) + 'ms' : 'N/A'
      },
      memory: performanceMetrics.memory.lastSample ? {
        used: formatBytes(performanceMetrics.memory.lastSample.usedJSHeapSize),
        total: formatBytes(performanceMetrics.memory.lastSample.totalJSHeapSize),
        percentage: ((performanceMetrics.memory.lastSample.usedJSHeapSize / 
                     performanceMetrics.memory.lastSample.totalJSHeapSize) * 100).toFixed(2) + '%'
      } : 'Not available'
    });
  }

  // Function to format duration
  function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }

  // Function to observe dynamic changes in the DOM
  function observeDynamicChanges() {
    console.log('Setting up MutationObserver for dynamic changes');
    
    const observer = new MutationObserver((mutations) => {
      const startTime = performance.now();
      console.log(`Processing ${mutations.length} mutations`);
      
      performanceMetrics.mutations.total += mutations.length;
      
      mutations.forEach((mutation, index) => {
        const mutationStartTime = performance.now();
        
        // Track mutation type
        performanceMetrics.mutations.byType[mutation.type] = 
          (performanceMetrics.mutations.byType[mutation.type] || 0) + 1;
        
        // Safely log mutation details
        console.log(`Mutation ${index + 1}:`, {
          type: mutation.type,
          target: mutation.target ? {
            tagName: mutation.target.tagName,
            id: mutation.target.id,
            className: mutation.target.className
          } : 'null',
          addedNodes: mutation.addedNodes ? mutation.addedNodes.length : 0,
          removedNodes: mutation.removedNodes ? mutation.removedNodes.length : 0,
          attributeName: mutation.attributeName,
          oldValue: mutation.oldValue
        });

        if (mutation.type === 'childList' && mutation.addedNodes) {
          mutation.addedNodes.forEach((node, nodeIndex) => {
            const nodeStartTime = performance.now();
            
            // Log detailed node information
            console.log(`Processing added node ${nodeIndex + 1}:`, {
              nodeType: node ? node.nodeType : 'null',
              nodeName: node ? node.nodeName : 'null',
              isElement: node ? node.nodeType === Node.ELEMENT_NODE : false,
              hasAttributes: node ? node.getAttribute !== undefined : false,
              hasTagName: node ? node.tagName !== undefined : false
            });

            // Only process Element nodes
            if (node && node.nodeType === Node.ELEMENT_NODE) {
              try {
                const elementInfo = {
                  tagName: node.tagName,
                  id: node.id || '',
                  className: node.className || '',
                  attributes: Array.from(node.attributes || []).map(attr => ({
                    name: attr.name,
                    value: attr.value
                  })),
                  isInteractive: isInteractiveElement(node)
                };

                console.log('Element details:', elementInfo);

                // Create a synthetic event for the added element
                const syntheticEvent = {
                  type: 'element_added',
                  target: node,
                  timestamp: Date.now()
                };

                recordEvent(syntheticEvent);

                const nodeDuration = trackEventTiming('element_added', nodeStartTime);
                console.log(`Node processing completed in ${nodeDuration.toFixed(2)}ms`);
              } catch (error) {
                console.warn('Error processing added node:', {
                  error: error.message,
                  stack: error.stack,
                  node: node ? {
                    type: node.nodeType,
                    name: node.nodeName,
                    id: node.id,
                    className: node.className,
                    hasAttributes: node.getAttribute !== undefined,
                    hasTagName: node.tagName !== undefined
                  } : 'null'
                });
              }
            } else {
              console.log('Skipping non-Element node:', {
                type: node ? node.nodeType : 'null',
                name: node ? node.nodeName : 'null',
                reason: 'Not an Element node'
              });
            }
          });
        }
        
        const mutationDuration = performance.now() - mutationStartTime;
        performanceMetrics.mutations.processingTimes.push(mutationDuration);
        
        // Keep only last 1000 mutation timing samples
        if (performanceMetrics.mutations.processingTimes.length > 1000) {
          performanceMetrics.mutations.processingTimes.shift();
        }
      });
      
      const totalDuration = performance.now() - startTime;
      console.log(`Mutation batch processed in ${totalDuration.toFixed(2)}ms`);
      
      // Track memory usage after processing mutations
      trackMemoryUsage();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    console.log('MutationObserver setup complete');
    return observer;
  }

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
    const observer = observeDynamicChanges();
    
    // Store the observer for cleanup
    window.taskRecorderObserver = observer;
    
    // Verify recording state
    console.log("Recording initialized with state:", {
      isRecording,
      currentTaskId,
      eventListeners: eventsToRemove.map(([event]) => event)
    });
  }

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
    // First check if element is valid and is an Element node
    if (!element || typeof element !== 'object' || element.nodeType !== Node.ELEMENT_NODE) {
      console.log('Element is not valid or not an Element node:', {
        hasElement: !!element,
        type: element ? typeof element : 'null',
        nodeType: element ? element.nodeType : 'null',
        expectedType: Node.ELEMENT_NODE
      });
      return false;
    }

    const interactiveTags = ['button', 'input', 'select', 'textarea', 'a'];
    const interactiveRoles = ['button', 'link', 'checkbox', 'radio', 'textbox', 'combobox', 'listbox', 'menuitem'];
    
    try {
      const tagName = element.tagName ? element.tagName.toLowerCase() : '';
      const role = element.getAttribute ? element.getAttribute('role') : null;
      const hasOnClick = element.onclick != null;
      const tabIndex = element.getAttribute ? element.getAttribute('tabindex') : null;

      const result = {
        isInteractive: false,
        reasons: []
      };

      if (interactiveTags.includes(tagName)) {
        result.isInteractive = true;
        result.reasons.push(`Has interactive tag: ${tagName}`);
      }
      if (role && interactiveRoles.includes(role)) {
        result.isInteractive = true;
        result.reasons.push(`Has interactive role: ${role}`);
      }
      if (hasOnClick) {
        result.isInteractive = true;
        result.reasons.push('Has onclick handler');
      }
      if (tabIndex === '0') {
        result.isInteractive = true;
        result.reasons.push('Has tabindex="0"');
      }

      console.log('Interactive element check result:', {
        element: {
          tagName,
          role,
          hasOnClick,
          tabIndex
        },
        ...result
      });

      return result.isInteractive;
    } catch (error) {
      console.warn('Error checking if element is interactive:', {
        error: error.message,
        stack: error.stack,
        element: {
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          nodeType: element.nodeType
        }
      });
      return false;
    }
  }

  // Quick check for images and links
  function isImageOrLink(element) {
    return element.tagName.toLowerCase() === 'img' || element.tagName.toLowerCase() === 'a';
  }

  // Get a CSS selector path to uniquely identify an element
  // This helps us find elements again later, even if the page changes
  function getElementCssPath(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';
    
    let path = [];
    while (element && element.nodeType === Node.ELEMENT_NODE) {
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
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';
    
    if (element.id !== '') {
      return `//*[@id="${element.id}"]`;
    }
    
    if (element === document.body) {
      return '/html/body';
    }
    
    let ix = 0;
    const parent = element.parentNode;
    
    // Check if parent exists and has childNodes
    if (!parent || !parent.childNodes) {
      return '';
    }
    
    const siblings = parent.childNodes;
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling === element) {
        const parentXPath = getElementXPath(parent);
        // Only append if we got a valid parent XPath
        return parentXPath ? `${parentXPath}/${element.tagName.toLowerCase()}[${ix + 1}]` : '';
      }
      if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === element.tagName) {
        ix++;
      }
    }
    
    return '';
  }

  // Function to get stable BID for an element
  function getStableBID(element) {
    if (!element || typeof element !== 'object' || element.nodeType !== Node.ELEMENT_NODE) {
      console.log('Invalid element in getStableBID:', {
        hasElement: !!element,
        type: element ? typeof element : 'null',
        nodeType: element ? element.nodeType : 'null'
      });
      return '';
    }

    try {
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

      if (element.getAttribute) {
        for (const { attr, prefix } of attributes) {
          const value = element.getAttribute(attr);
          if (value) {
            return prefix + value.toLowerCase().replace(/[^a-z0-9]/g, '-');
          }
        }
      }

      // Fallback: always generate a semantic hash
      const tag = element.tagName ? element.tagName.toLowerCase() : 'unknown';
      const classes = element.className && typeof element.className === 'string'
        ? element.className.split(/\s+/).filter(c => c).join('-')
        : '';
      const text = element.textContent ? element.textContent.trim().substring(0, 30) : '';
      const siblings = Array.from(element.parentNode?.children || []);
      const index = siblings.indexOf(element);
      const semanticId = `${tag}-${classes}-${text}-${index}`;
      const hash = hashString(semanticId);
      return `${tag}${classes ? '-' + classes : ''}-${hash}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    } catch (error) {
      console.warn('Error getting stable BID:', {
        error: error.message,
        stack: error.stack,
        element: {
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          nodeType: element.nodeType
        }
      });
      return '';
    }
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

  // Function to safely send message to background script
  function safeSendMessage(message) {
    // Validate message
    if (!message || typeof message !== 'object') {
      console.warn('Invalid message format:', message);
      return Promise.resolve();
    }

    // Check if we're in an extension context and chrome.runtime is available
    if (typeof chrome === 'undefined' || !chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
      console.warn('Chrome runtime not available, storing event locally only');
      // Store event locally if possible
      try {
        if (typeof localStorage !== 'undefined') {
          const storedEvents = JSON.parse(localStorage.getItem('eventCaptureBackup') || '[]');
          storedEvents.push({
            ...message,
            timestamp: Date.now(),
            storedLocally: true
          });
          localStorage.setItem('eventCaptureBackup', JSON.stringify(storedEvents));
        }
      } catch (e) {
        console.warn('Failed to store event locally:', e);
      }
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let hasResolved = false;
      
      try {
        // Set a timeout to prevent hanging
        const timeoutId = setTimeout(() => {
          if (!hasResolved) {
            hasResolved = true;
            console.warn('Message send timeout');
            resolve();
          }
        }, 2000); // 2 second timeout

        // Send message and handle response
        chrome.runtime.sendMessage(message, response => {
          if (!hasResolved) {
            hasResolved = true;
            clearTimeout(timeoutId);
            
            if (chrome.runtime.lastError) {
              console.warn('Error sending message:', chrome.runtime.lastError);
              resolve();
            } else {
              resolve(response);
            }
          }
        });
      } catch (error) {
        if (!hasResolved) {
          hasResolved = true;
          console.warn('Error sending message to background:', error);
          resolve();
        }
      }
    });
  }

  // Enhanced function to record an event
  function recordEvent(event) {
    if (!isRecording) return;
    
    // Validate that we have a valid event and target
    if (!event || !event.target || typeof event.target !== 'object' || event.target.nodeType !== Node.ELEMENT_NODE) {
      console.warn('Invalid event or target in recordEvent:', {
        hasEvent: !!event,
        hasTarget: !!event?.target,
        targetType: event?.target ? typeof event.target : 'null',
        targetNodeType: event?.target ? event.target.nodeType : 'null'
      });
      return;
    }

    try {
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
          attributes: Array.from(event.target.attributes || []).reduce((acc, attr) => {
            acc[attr.name] = attr.value;
            return acc;
          }, {})
        }
      };

      // Safely get bounding box if available
      try {
        if (event.target.getBoundingClientRect) {
          const rect = event.target.getBoundingClientRect();
          eventData.target.boundingBox = {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left
          };
        }
      } catch (rectError) {
        console.warn('Error getting bounding rect:', {
          error: rectError.message,
          element: {
            tagName: event.target.tagName,
            id: event.target.id,
            className: event.target.className
          }
        });
      }

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

      // Store locally first
      events.push(eventData);

      // Try to send to background script
      safeSendMessage({
        type: 'recordedEvent',
        event: eventData
      }).catch(error => {
        console.warn('Error in message sending:', error);
      });

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
    } catch (error) {
      console.warn('Error recording event:', {
        error: error.message,
        stack: error.stack,
        event: {
          type: event?.type,
          target: event?.target ? {
            tagName: event.target.tagName,
            id: event.target.id,
            className: event.target.className,
            nodeType: event.target.nodeType
          } : null
        }
      });
    }
  }

  // Update event listeners to use capture phase
  document.addEventListener('click', recordEvent, true);
  document.addEventListener('mousedown', recordEvent, true);
  document.addEventListener('mouseup', recordEvent, true);
  document.addEventListener('keydown', recordEvent, true);
  document.addEventListener('input', recordEvent, true);
  document.addEventListener('change', recordEvent, true);

  // Simple function to get accessibility identifiers for an element
  function getA11yIdentifiers(element) {
    if (!element || typeof element !== 'object' || element.nodeType !== Node.ELEMENT_NODE) {
      console.log('Invalid element in getA11yIdentifiers:', {
        hasElement: !!element,
        type: element ? typeof element : 'null',
        nodeType: element ? element.nodeType : 'null'
      });
      return {};
    }
    
    try {
      return {
        // Role is the most important identifier in the a11y tree
        role: (element.getAttribute ? element.getAttribute('role') : null) || getImplicitRole(element),
        
        // Name is how the element is announced (crucial for identification)
        name: getAccessibleName(element),
        
        // Basic path through the a11y tree (for locating in the tree)
        path: getSimpleA11yPath(element),
        
        // Additional identifiers that help locate the element
        id: element.id || '',
        tagName: element.tagName ? element.tagName.toLowerCase() : ''
      };
    } catch (error) {
      console.warn('Error getting a11y identifiers:', {
        error: error.message,
        stack: error.stack,
        element: {
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          nodeType: element.nodeType
        }
      });
      return {};
    }
  }

  // Get a simple path through the accessibility tree
  function getSimpleA11yPath(element) {
    if (!element || typeof element !== 'object' || element.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }
    
    try {
      const path = [];
      let current = element;
      let depth = 0;
      const MAX_DEPTH = 5; // Limit path depth to avoid excessive length
      
      while (current && current.nodeType === Node.ELEMENT_NODE && depth < MAX_DEPTH) {
        const role = current.getAttribute ? current.getAttribute('role') : null || getImplicitRole(current);
        const name = getAccessibleName(current);
        
        let pathSegment = role || (current.tagName ? current.tagName.toLowerCase() : '');
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
    } catch (error) {
      console.warn('Error getting a11y path:', {
        error: error.message,
        stack: error.stack,
        element: {
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          nodeType: element.nodeType
        }
      });
      return '';
    }
  }

  // Simple function to get accessible name
  function getAccessibleName(element) {
    if (!element || typeof element !== 'object' || element.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    try {
      // Check common name sources in priority order
      if (element.getAttribute) {
        return element.getAttribute('aria-label') || 
               element.getAttribute('alt') || 
               element.getAttribute('title') || 
               (element.textContent ? element.textContent.trim().substring(0, 50) : '') || '';
      }
      return element.textContent ? element.textContent.trim().substring(0, 50) : '';
    } catch (error) {
      console.warn('Error getting accessible name:', {
        error: error.message,
        stack: error.stack,
        element: {
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          nodeType: element.nodeType
        }
      });
      return '';
    }
  }

  // Simple function to determine implicit role
  function getImplicitRole(element) {
    if (!element || typeof element !== 'object' || element.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    try {
      const tagName = element.tagName ? element.tagName.toLowerCase() : '';
      
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
    } catch (error) {
      console.warn('Error getting implicit role:', {
        error: error.message,
        stack: error.stack,
        element: {
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          nodeType: element.nodeType
        }
      });
      return '';
    }
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

  // Create debounced version of recordInput with longer delay
  const debouncedRecordInput = debounce((e) => {
    // Only record input events if the value has actually changed
    if (e.target.value !== lastEventData.lastInputValue) {
      recordEvent(e);
    }
  }, 500); // Increased to 500ms debounce

  // Function to clean up event listeners
  function cleanupEventListeners() {
    console.log("Cleaning up event listeners");
    
    // Remove all event listeners
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
    
    // Disconnect observer if it exists
    if (dynamicObserver) {
      try {
        dynamicObserver.disconnect();
        dynamicObserver = null;
      } catch (e) {
        console.error("Error disconnecting observer:", e);
      }
    }
    
    console.log("Event listeners cleaned up");
  }

  // Function to stop recording normally
  function stopRecording() {
    console.log("Stopping recording");
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
    
    // Save the events to the task history
    if (currentTaskId) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.get(['taskHistory'], function(data) {
          const taskHistory = data.taskHistory || {};
          
          if (taskHistory[currentTaskId]) {
            taskHistory[currentTaskId].events = events;
            
            // Save the updated task history
            chrome.storage.local.set({ taskHistory: taskHistory }, function() {
              console.log("Events saved to task history");
              currentTaskId = null;
              resolve();
            });
          } else {
            currentTaskId = null;
            resolve();
          }
        });
      });
    }
    
    currentTaskId = null;
    return Promise.resolve();
  }

  // Function to force stop recording regardless of errors
  function forceStopRecording() {
    console.log("Force stopping recording");
    
    // Immediately set recording state to false
    isRecording = false;
    window.isRecording = false;
    
    try {
      // Remove all event listeners
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
        try {
          document.removeEventListener(event, handler, true);
        } catch (e) {
          console.warn(`Error removing ${event} listener:`, e);
        }
      });
    } catch (e) {
      console.warn("Error during event listener cleanup:", e);
    }
    
    // Disconnect observer if it exists
    if (dynamicObserver) {
      try {
        dynamicObserver.disconnect();
        dynamicObserver = null;
      } catch (e) {
        console.warn("Error disconnecting observer:", e);
      }
    }
    
    // Clear any pending timeouts
    try {
      if (window.timerInterval) {
        clearInterval(window.timerInterval);
        window.timerInterval = null;
      }
    } catch (e) {
      console.warn("Error clearing timer interval:", e);
    }
    
    // Save any remaining events
    try {
      if (currentTaskId && events.length > 0) {
        chrome.storage.local.get(['taskHistory'], function(data) {
          try {
            const taskHistory = data.taskHistory || {};
            if (taskHistory[currentTaskId]) {
              taskHistory[currentTaskId].events = events;
              chrome.storage.local.set({ taskHistory: taskHistory });
            }
          } catch (e) {
            console.warn("Error saving final events:", e);
          }
        });
      }
    } catch (e) {
      console.warn("Error during final event save:", e);
    }
    
    // Reset all state
    currentTaskId = null;
    window.currentTaskId = null;
    events = [];
    window.recordedEvents = [];
    
    console.log("Recording force stopped");
  }

  // Listen for messages from the popup
  if (typeof chrome !== 'undefined' && chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log("Received message:", message);
      
      if (!message || typeof message !== 'object') {
        console.error("Invalid message format received");
        sendResponse({ status: "error", error: "Invalid message format" });
        return false;
      }

      if (message.action === "startRecording") {
        try {
          if (!message.taskId) {
            throw new Error("No taskId provided");
          }
          
          console.log("Starting recording for task:", message.taskId);
          startRecording(message.taskId);
          sendResponse({ status: "recording started" });
        } catch (error) {
          console.error("Error starting recording:", error);
          sendResponse({ status: "error", error: error.message });
        }
        return false; // Don't keep the message channel open for synchronous response
      }
      
      if (message.action === "stopRecording") {
        console.log("Stopping recording");
        
        // Immediately set recording state to false
        isRecording = false;
        
        // Create a promise that will resolve with the response
        const stopPromise = new Promise((resolve) => {
          // First try normal stop
          stopRecording()
            .then(() => {
              console.log("Recording stopped successfully");
              resolve({ status: "recording stopped" });
            })
            .catch(error => {
              console.error("Error during normal stop, forcing stop:", error);
              // If normal stop fails, force stop
              forceStopRecording();
              resolve({ status: "recording force stopped" });
            });
        });

        // Set a timeout to ensure we always send a response
        const timeoutId = setTimeout(() => {
          console.warn("Stop recording timeout - forcing stop");
          forceStopRecording();
          sendResponse({ status: "recording force stopped due to timeout" });
        }, 2000); // 2 second timeout

        // Handle the stop promise
        stopPromise
          .then(response => {
            clearTimeout(timeoutId);
            sendResponse(response);
          })
          .catch(error => {
            clearTimeout(timeoutId);
            console.error("Error in stop promise:", error);
            forceStopRecording();
            sendResponse({ status: "recording force stopped due to error" });
          });

        return true; // Keep the message channel open for async response
      }
      
      // For any other messages, send an error response
      sendResponse({ status: "error", error: "Unknown action" });
      return false; // Don't keep the message channel open for synchronous response
    });
  } else {
    console.warn('Chrome runtime message listener not available');
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
})(); // End of IIFE
