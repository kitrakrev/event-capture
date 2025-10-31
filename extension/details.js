// Details window script for viewing a task's recorded events.
//
// Purpose: Render a human-readable view of a single task's events with basic
// filtering and sorting. Provides a button that pushes the normalized task
// payload to the configured backend (the same flow used by the popup).
//
// What it does:
// - Reads the taskId from the query string.
// - Loads the task from chrome.storage.local and renders events.
// - Provides simple filter (by type) and sort (by timestamp/type).
// - Includes a push button to POST the task to the backend API.

// Parse taskId from URL
const urlParams = new URLSearchParams(window.location.search);
const taskId = urlParams.get('taskId');

document.getElementById('eventData').textContent = 'Loading...';
document.getElementById('eventCount').textContent = '';

const pushButton = document.getElementById('pushToMongoBtn');
let currentTask = null;

function normalizeEvents(events = []) {
  return events.map((event) => ({
    ...event,
    video_timestamp: typeof event.video_timestamp === 'number'
      ? event.video_timestamp
      : (typeof event.videoTimeMs === 'number' ? event.videoTimeMs : null),
  }));
}

async function pushTaskToMongo(buttonElement) {
  if (!currentTask || !Array.isArray(currentTask.events) || currentTask.events.length === 0) {
    alert('No event data available to push.');
    return;
  }

  const payload = buildTaskPayload(currentTask);
  if (!payload) {
    alert('Unable to build payload from task data.');
    return;
  }

  payload.data = currentTask.events;
  if (currentTask.video_local_path) payload.video_local_path = currentTask.video_local_path;
  if (currentTask.video_server_path) payload.video_server_path = currentTask.video_server_path;

  try {
    if (buttonElement) {
      buttonElement.disabled = true;
      buttonElement.textContent = 'Pushing...';
    }

    const result = await sendTaskPayload(payload);
    if (
      result &&
      result.folderIso &&
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      typeof chrome.runtime.sendMessage === 'function'
    ) {
      try {
        await chrome.runtime.sendMessage({ type: 'INGEST_DONE', folderIso: result.folderIso });
      } catch (messageError) {
        console.warn('Failed to notify background of INGEST_DONE:', messageError);
      }
    }

    try {
      await savePayloadAndAssets(currentTask, payload, { success: true, response: result });
    } catch (archiveError) {
      console.warn('Failed to archive payload locally:', archiveError);
    }

    alert('Data successfully pushed to MongoDB!');
  } catch (error) {
    console.error('Error pushing to MongoDB:', error);
    try {
      await savePayloadAndAssets(currentTask, payload, { success: false, error: error.message });
    } catch (archiveError) {
      console.warn('Failed to archive payload after error:', archiveError);
    }
    alert('Error pushing to MongoDB: ' + error.message);
  } finally {
    if (buttonElement) {
      buttonElement.disabled = false;
      buttonElement.textContent = 'Push to MongoDB';
    }
  }
}

document.addEventListener('DOMContentLoaded', function() {
  chrome.storage.local.get(['taskHistory'], (data) => {
    const task = data.taskHistory?.[taskId];
    if (!task) {
      document.getElementById('taskTitle').textContent = 'Task not found';
      document.getElementById('eventData').textContent = '';
      if (pushButton) pushButton.disabled = true;
      return;
    }

    document.getElementById('taskTitle').textContent = task.title;
    const events = normalizeEvents(task.events || []);
    const eventTypes = Array.from(new Set(events.map(e => e.type))).sort();
    currentTask = { ...task, events };

    // Populate filter dropdown
    const filter = document.getElementById('eventTypeFilter');
    filter.innerHTML = '<option value="">All</option>' + eventTypes.map(type => `<option value="${type}">${type}</option>`).join('');
    let currentSort = 'timestamp';
    let currentFilter = '';

    function renderEvents() {
      let filtered = events;
      if (currentFilter) filtered = filtered.filter(e => e.type === currentFilter);
      if (currentSort === 'type') {
        filtered = filtered.slice().sort((a, b) => a.type.localeCompare(b.type) || a.timestamp - b.timestamp);
      } else {
        filtered = filtered.slice().sort((a, b) => a.timestamp - b.timestamp);
      }
      document.getElementById('eventCount').textContent = `Total Events: ${filtered.length}`;
      // Show full JSON with video paths and per-event timestamps
      const full = {
        id: task.id,
        title: task.title,
        startUrl: task.startUrl,
        endUrl: task.endUrl,
        durationSeconds: Math.floor(((task.endTime||0) - (task.startTime||0)) / 1000),
        video_local_path: task.video_local_path || null,
        video_server_path: task.video_server_path || null,
        events: filtered.map(e => ({
          ...e,
          video_timestamp: typeof e.video_timestamp === 'number' ? e.video_timestamp : (typeof e.videoTimeMs === 'number' ? e.videoTimeMs : null)
        }))
      };
      document.getElementById('eventData').textContent = JSON.stringify(full, null, 2);
    }

    filter.addEventListener('change', function(e) {
      currentFilter = e.target.value;
      renderEvents();
    });

    document.getElementById('sortBtn').addEventListener('click', function() {
      if (currentSort === 'timestamp') {
        currentSort = 'type';
        this.textContent = 'Sort by Timestamp';
      } else {
        currentSort = 'timestamp';
        this.textContent = 'Sort by Event Type';
      }
      renderEvents();
    });

    if (pushButton) {
      pushButton.disabled = events.length === 0;
      pushButton.addEventListener('click', function() {
        pushTaskToMongo(pushButton);
      });
    }

    renderEvents();
  });
});
