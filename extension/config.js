// Client-side API helpers for the Chrome extension.
//
// Purpose: Build the task payload and send it to the backend API. Optionally
// supports local downloads (now disabled by default since archiving happens
// on the server).
//
// What it does:
// - buildTaskPayload(taskData): normalize task data from storage/UI.
// - sendTaskPayload(payload): POST to the API endpoint with optional x-api-key.
// - savePayloadAndAssets(): currently a no-op (archiving done by server).
// - Utility helpers for downloads remain for potential future use.

// Shared configuration and helpers for communicating with the backend API.
// Update these constants to match your deployment.
const API_ENDPOINT = 'http://localhost:3000/api/events';
const API_KEY = '';
const LOCAL_ARCHIVE_ROOT = 'event-capture-archives';

function buildTaskPayload(taskData) {
  if (!taskData) {
    return null;
  }

  const events = Array.isArray(taskData.events) ? taskData.events : [];
  const startTime = typeof taskData.startTime === 'number' ? taskData.startTime : null;
  const endTimeRaw = typeof taskData.endTime === 'number' ? taskData.endTime : Date.now();
  const effectiveStart = startTime ?? Date.now();
  const durationSeconds = Math.max(0, Math.round((endTimeRaw - effectiveStart) / 1000));

  return {
    task: taskData.title || taskData.task || 'Untitled Task',
    duration: durationSeconds,
    events_recorded: events.length,
    start_url: taskData.startUrl || null,
    end_url: taskData.endUrl || null,
    data: events,
  };
}

async function sendTaskPayload(payload, extraHeaders = {}) {
  if (!API_ENDPOINT) {
    throw new Error('API endpoint is not configured. Update config.js.');
  }

  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  if (API_KEY) {
    headers['x-api-key'] = API_KEY;
  }

  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers,
    credentials: 'omit',
    body: JSON.stringify(payload),
  });

  let result;
  try {
    result = await response.json();
  } catch (error) {
    result = {};
  }

  if (!response.ok) {
    throw new Error(result.error || `Request failed with status ${response.status}`);
  }

  return result;
}

async function uploadRecordedVideo(folderIso, blob) {
  const form = new FormData();
  form.append('folderIso', folderIso);
  form.append('file', new File([blob], 'video.webm', { type: 'video/webm' }));

  const headers = {};
  if (API_KEY) headers['x-api-key'] = API_KEY;

  const base = API_ENDPOINT.replace('/api/events', '');
  const resp = await fetch(`${base}/api/events/video`, { method: 'POST', body: form, headers });
  if (!resp.ok) {
    const tx = await resp.text().catch(() => '');
    throw new Error(tx || `Upload failed ${resp.status}`);
  }
  return await resp.json().catch(() => ({}));
}

function canArchiveLocally() {
  return typeof chrome !== 'undefined' && chrome.downloads && typeof chrome.downloads.download === 'function';
}

function formatTimestampForArchive(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function downloadBlob(blob, filename) {
  return new Promise((resolve, reject) => {
    if (!canArchiveLocally()) {
      resolve(null);
      return;
    }

    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Download failed:', chrome.runtime.lastError);
        URL.revokeObjectURL(url);
        reject(chrome.runtime.lastError);
        return;
      }

      // Revoke URL after a short delay to allow download to start
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve(downloadId);
    });
  });
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  return downloadBlob(blob, filename);
}

// Screenshot logic removed

function downloadDataUrl(filename, dataUrl) {
  return new Promise((resolve, reject) => {
    if (!canArchiveLocally()) {
      resolve(null);
      return;
    }

    chrome.downloads.download({ url: dataUrl, filename, saveAs: false }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Download failed:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(downloadId);
    });
  });
}

async function savePayloadAndAssets(taskData, payload, responseDetails = {}) {
  // No-op: archiving happens on the server; screenshot logic removed
  return;
}
