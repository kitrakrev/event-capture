// Get task ID from URL
const urlParams = new URLSearchParams(window.location.search);
const taskId = urlParams.get('taskId');

// DOM elements
let taskTitle, eventData, eventTypeFilter, sortBtn, eventCount, screenRecording, taskDuration, startUrl, endUrl;

// Function to initialize DOM elements
function initializeDOMElements() {
  taskTitle = document.getElementById('taskTitle');
  eventData = document.getElementById('eventData');
  eventTypeFilter = document.getElementById('eventTypeFilter');
  sortBtn = document.getElementById('sortBtn');
  eventCount = document.getElementById('eventCount');
  screenRecording = document.getElementById('screenRecording');
  taskDuration = document.getElementById('taskDuration');
  startUrl = document.getElementById('startUrl');
  endUrl = document.getElementById('endUrl');

  // Verify all required elements exist
  const requiredElements = {
    taskTitle,
    eventData,
    eventTypeFilter,
    sortBtn,
    eventCount,
    screenRecording,
    taskDuration,
    startUrl,
    endUrl
  };

  const missingElements = Object.entries(requiredElements)
    .filter(([_, element]) => !element)
    .map(([name]) => name);

  if (missingElements.length > 0) {
    console.error('Missing required DOM elements:', missingElements);
    throw new Error(`Missing required DOM elements: ${missingElements.join(', ')}`);
  }
}

// Function to get video from IndexedDB
async function getVideoFromIndexedDB(taskId) {
  console.log('Attempting to retrieve video for task:', taskId);
  
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('TaskVideos', 1);
    
    request.onerror = () => {
      console.error('Error opening IndexedDB:', request.error);
      reject(request.error);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      // Create the videos object store if it doesn't exist
      if (!db.objectStoreNames.contains('videos')) {
        db.createObjectStore('videos');
      }
    };
    
    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(['videos'], 'readonly');
      const store = transaction.objectStore('videos');
      
      const getRequest = store.get(taskId);
      
      getRequest.onsuccess = () => {
        db.close();
        if (getRequest.result) {
          console.log('Video found in IndexedDB, creating URL');
          const url = URL.createObjectURL(getRequest.result);
          resolve(url);
        } else {
          console.log('No video found in IndexedDB for task:', taskId);
          resolve(null);
        }
      };
      
      getRequest.onerror = () => {
        console.error('Error retrieving video from IndexedDB:', getRequest.error);
        db.close();
        reject(getRequest.error);
      };
    };
  });
}

// Function to render events
function renderEvents(events) {
  if (!eventData || !eventCount) {
    console.error('Required DOM elements not found for rendering events');
    return;
  }

  try {
    eventData.textContent = JSON.stringify(events, null, 2);
    eventCount.textContent = `Total Events: ${events.length}`;
  } catch (error) {
    console.error('Error rendering events:', error);
    eventData.textContent = 'Error rendering events. Please try refreshing the page.';
  }
}

// Function to format duration
function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

// Function to load and display task data
async function loadTaskData() {
  try {
    const result = await chrome.storage.local.get(['taskHistory']);
    const taskHistory = result.taskHistory || {};
    const task = taskHistory[taskId];

    if (!task) {
      if (eventData) {
        eventData.textContent = 'Task not found';
      }
      return;
    }

    // Set task title
    if (taskTitle) {
      taskTitle.textContent = `Task: ${task.title}`;
    }

    // Set task info
    const duration = task.endTime ? Math.floor((task.endTime - task.startTime) / 1000) : 0;
    if (taskDuration) {
      taskDuration.textContent = formatDuration(duration);
    }
    if (startUrl) {
      startUrl.textContent = task.startUrl || 'N/A';
    }
    if (endUrl) {
      endUrl.textContent = task.endUrl || 'N/A';
    }

    // Get video from IndexedDB if available
    if (task.hasVideo && screenRecording) {
      try {
        console.log('Task has video flag, attempting to retrieve video');
        const videoUrl = await getVideoFromIndexedDB(taskId);
        if (videoUrl) {
          console.log('Setting video source:', videoUrl);
          screenRecording.src = videoUrl;
          screenRecording.onerror = (e) => {
            console.error('Error loading video:', e);
            if (screenRecording.parentElement) {
              screenRecording.parentElement.style.display = 'none';
            }
          };
          screenRecording.onloadeddata = () => {
            console.log('Video loaded successfully');
          };
        } else {
          console.log('No video URL returned, hiding video container');
          if (screenRecording.parentElement) {
            screenRecording.parentElement.style.display = 'none';
          }
        }
      } catch (error) {
        console.error('Error retrieving video:', error);
        if (screenRecording.parentElement) {
          screenRecording.parentElement.style.display = 'none';
        }
      }
    } else {
      console.log('Task does not have video flag or video element not found');
      if (screenRecording && screenRecording.parentElement) {
        screenRecording.parentElement.style.display = 'none';
      }
    }

    // Get unique event types for filter
    if (eventTypeFilter) {
      const eventTypes = [...new Set(task.events.map(event => event.type))];
      eventTypes.forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type;
        eventTypeFilter.appendChild(option);
      });
    }

    // Initial render
    renderEvents(task.events);

    // Add event listeners
    if (eventTypeFilter) {
      eventTypeFilter.addEventListener('change', () => {
        const selectedType = eventTypeFilter.value;
        const filteredEvents = selectedType === 'all' 
          ? task.events 
          : task.events.filter(event => event.type === selectedType);
        renderEvents(filteredEvents);
      });
    }

    if (sortBtn) {
      sortBtn.addEventListener('click', () => {
        const selectedType = eventTypeFilter?.value || 'all';
        const filteredEvents = selectedType === 'all' 
          ? task.events 
          : task.events.filter(event => event.type === selectedType);
        filteredEvents.sort((a, b) => a.type.localeCompare(b.type));
        renderEvents(filteredEvents);
      });
    }
  } catch (error) {
    console.error('Error loading task data:', error);
    if (eventData) {
      eventData.textContent = 'Error loading task data. Please try refreshing the page.';
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  try {
    initializeDOMElements();
    await loadTaskData();
  } catch (error) {
    console.error('Error initializing page:', error);
    if (eventData) {
      eventData.textContent = 'Error initializing page. Please try refreshing the page.';
    }
  }
}); 