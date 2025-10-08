// Background service worker for the Chrome extension.
//
// Purpose: Coordinate recording across tabs, inject the content script after
// navigations, and persist events sent by the recorder into chrome.storage.
//
// What it does:
// - On tab updates: injects `recorder.js` when the recording tab navigates.
// - On messages from `recorder.js`: appends events to the active task history.
// - Handles UI actions: open detailed view, export a task to JSON, delete a task.
// - Records high-level events (navigation, new tab) while recording is active.

// Screen recording state
let videoRecording = {
  isActive: false,
  startedAtMs: null,
  folderIso: null,
  localPath: null
};
let pendingVideoBlob = null;

// API base (fallback safe if config.js is not available in SW)
const API_BASE = (typeof API_ENDPOINT !== 'undefined' && API_ENDPOINT)
  ? API_ENDPOINT.replace('/api/events','')
  : 'http://localhost:3000';
const API_KEY_HEADER = (typeof API_KEY !== 'undefined' && API_KEY) ? { 'x-api-key': API_KEY } : {};

async function ensureOffscreenDocument() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Record whole screen during task' // Required by Chrome
  });
}

async function startScreenRecording() {
  await ensureOffscreenDocument();
  await chrome.runtime.sendMessage({ type: 'OFFSCREEN_START' });
}

async function stopScreenRecording() {
  await chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'POPUP_START_VIDEO') {
    startScreenRecording().then(() => sendResponse?.({ ok: true })).catch(err => {
      console.error('start video failed', err);
      sendResponse?.({ ok: false, error: String(err) });
    });
    return true;
  }
  if (message.type === 'POPUP_STOP_VIDEO') {
    stopScreenRecording().then(() => {
      // Compute and save local path immediately from videoStartedAtMs
      chrome.storage.local.get(['taskHistory', 'lastCompletedTaskId', 'videoStartedAtMs'], (data) => {
        const taskId = data.lastCompletedTaskId;
        if (taskId && data.taskHistory && data.taskHistory[taskId]) {
          // Compute path from videoStartedAtMs
          const baseIso = data.videoStartedAtMs 
            ? new Date(data.videoStartedAtMs).toISOString().replace(/[:.]/g, '-') 
            : (videoRecording.startedAtMs ? new Date(videoRecording.startedAtMs).toISOString().replace(/[:.]/g, '-') : null);
          
          if (baseIso) {
            const computedPath = `event-capture-archives/${baseIso}/video.webm`;
            data.taskHistory[taskId].video_local_path = computedPath;
            chrome.storage.local.set({ taskHistory: data.taskHistory });
            console.log('Video local path saved on stop:', computedPath);
          }
        }
      });
      sendResponse?.({ ok: true });
    }).catch(err => {
      console.error('stop video failed', err);
      sendResponse?.({ ok: false, error: String(err) });
    });
    return true;
  }
  if (message.type === 'OFFSCREEN_STARTED') {
    videoRecording.isActive = true;
    videoRecording.startedAtMs = message.startedAtMs;
    chrome.storage.local.set({ videoStartedAtMs: message.startedAtMs });
    sendResponse?.({ ok: true });
    return true;
  }
  if (message.type === 'OFFSCREEN_STOPPED') {
    videoRecording.isActive = false;
    sendResponse?.({ ok: true });
    return true;
  }
  if (message.type === 'OFFSCREEN_BLOB_READY') {
    // Blob has been persisted to a data URL in offscreen; request upload
    const { blobUrl } = message;
    (async () => {
      try {
        const res = await fetch(blobUrl);
        const blob = await res.blob();
        // 1) Save locally first under Downloads/event-capture-archives/<iso>/video.webm
        const baseIso = videoRecording.startedAtMs ? new Date(videoRecording.startedAtMs).toISOString().replace(/[:.]/g, '-') : String(Date.now());
        const filename = `event-capture-archives/${baseIso}/video.webm`;

        // Convert blob to data URL (service workers don't have URL.createObjectURL)
        await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result;
            chrome.downloads.download({
              url: dataUrl,
              filename,
              saveAs: false,
              conflictAction: 'overwrite'
            }, (downloadId) => {
              if (chrome.runtime.lastError) {
                console.error('Video local save failed:', chrome.runtime.lastError);
                // Even if video save fails, attempt to save trace below
              }
              // Try to resolve absolute path using downloads API
              if (typeof downloadId === 'number') {
                chrome.downloads.search({ id: downloadId }, (items) => {
                  const abs = Array.isArray(items) && items[0] && items[0].filename ? items[0].filename : null;
                  if (abs) {
                    // Persist absolute path on last completed task
                    chrome.storage.local.get(['taskHistory','lastCompletedTaskId'], (data) => {
                      const taskId = data.lastCompletedTaskId;
                      if (taskId && data.taskHistory && data.taskHistory[taskId]) {
                        data.taskHistory[taskId].video_local_path = abs;
                        chrome.storage.local.set({ taskHistory: data.taskHistory });
                      }
                    });
                  }
                  // After video save, also save a trace.json alongside it
                  chrome.storage.local.get(['taskHistory','lastCompletedTaskId'], (data2) => {
                    const taskId = data2.lastCompletedTaskId;
                    const task = taskId && data2.taskHistory ? data2.taskHistory[taskId] : null;
                    if (!task) { resolve(); return; }

                    const durationSeconds = typeof task.startTime === 'number' && typeof task.endTime === 'number'
                      ? Math.max(0, Math.floor((task.endTime - task.startTime) / 1000))
                      : null;
                      const trace = {
                      id: task.id,
                      title: task.title,
                      startUrl: task.startUrl || null,
                      endUrl: task.endUrl || null,
                      durationSeconds,
                      video_local_path: (data2.taskHistory[taskId] && data2.taskHistory[taskId].video_local_path) || filename,
                      video_server_path: task.video_server_path || null,
                      events: Array.isArray(task.events) ? task.events.map(e => ({
                        ...e,
                        video_timestamp: typeof e.video_timestamp === 'number' ? e.video_timestamp : (typeof e.videoTimeMs === 'number' ? e.videoTimeMs : null),
                        video_event_start_ms: typeof e.video_event_start_ms === 'number' ? e.video_event_start_ms : (typeof e.video_timestamp === 'number' ? e.video_timestamp : (typeof e.videoTimeMs === 'number' ? e.videoTimeMs : null)),
                        video_event_end_ms: typeof e.video_event_end_ms === 'number' ? e.video_event_end_ms : (typeof e.video_timestamp === 'number' ? e.video_timestamp : (typeof e.videoTimeMs === 'number' ? e.videoTimeMs : null))
                      })) : []
                    };

                    try {
                      const blobTrace = new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' });
                      const fr = new FileReader();
                      fr.onloadend = () => {
                        const traceUrl = fr.result;
                        const traceName = `event-capture-archives/${baseIso}/trace.json`;
                        chrome.downloads.download({ url: traceUrl, filename: traceName, saveAs: false, conflictAction: 'overwrite' }, () => {
                          if (chrome.runtime.lastError) {
                            console.error('Trace save failed:', chrome.runtime.lastError);
                          }
                          resolve();
                        });
                      };
                      fr.readAsDataURL(blobTrace);
                    } catch (err) {
                      console.error('Trace serialization failed:', err);
                      resolve();
                    }
                  });
                });
              } else {
                // No downloadId returned; still attempt to write trace.json
                chrome.storage.local.get(['taskHistory','lastCompletedTaskId'], (data2) => {
                  const taskId = data2.lastCompletedTaskId;
                  const task = taskId && data2.taskHistory ? data2.taskHistory[taskId] : null;
                  if (!task) { resolve(); return; }
                  const durationSeconds = typeof task.startTime === 'number' && typeof task.endTime === 'number'
                    ? Math.max(0, Math.floor((task.endTime - task.startTime) / 1000))
                    : null;
                  const trace = {
                    id: task.id,
                    title: task.title,
                    startUrl: task.startUrl || null,
                    endUrl: task.endUrl || null,
                    durationSeconds,
                    video_local_path: filename, // Saved in user's default downloads folder
                    video_server_path: task.video_server_path || null,
                    events: Array.isArray(task.events) ? task.events.map(e => ({
                      ...e,
                      video_timestamp: typeof e.video_timestamp === 'number' ? e.video_timestamp : (typeof e.videoTimeMs === 'number' ? e.videoTimeMs : null),
                      video_event_start_ms: typeof e.video_event_start_ms === 'number' ? e.video_event_start_ms : (typeof e.video_timestamp === 'number' ? e.video_timestamp : (typeof e.videoTimeMs === 'number' ? e.videoTimeMs : null)),
                      video_event_end_ms: typeof e.video_event_end_ms === 'number' ? e.video_event_end_ms : (typeof e.video_timestamp === 'number' ? e.video_timestamp : (typeof e.videoTimeMs === 'number' ? e.videoTimeMs : null))
                    })) : []
                  };
                  try {
                    const blobTrace = new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' });
                    const fr = new FileReader();
                    fr.onloadend = () => {
                      const traceUrl = fr.result;
                      const traceName = `event-capture-archives/${baseIso}/trace.json`;
                      chrome.downloads.download({ url: traceUrl, filename: traceName, saveAs: false, conflictAction: 'overwrite' }, () => {
                        if (chrome.runtime.lastError) {
                          console.error('Trace save failed:', chrome.runtime.lastError);
                        }
                        resolve();
                      });
                    };
                    fr.readAsDataURL(blobTrace);
                  } catch (err) {
                    console.error('Trace serialization failed:', err);
                    resolve();
                  }
                });
              }
            });
          };
          reader.readAsDataURL(blob);
        });

        // Store for later upload when folderIso is known
        pendingVideoBlob = blob;
        videoRecording.localPath = filename; // relative path under Downloads

        // Also persist local path to last completed task immediately
        chrome.storage.local.get(['taskHistory','lastCompletedTaskId'], (data) => {
          const taskId = data.lastCompletedTaskId;
          if (taskId && data.taskHistory && data.taskHistory[taskId]) {
            data.taskHistory[taskId].video_local_path = filename;
            chrome.storage.local.set({ taskHistory: data.taskHistory });
          }
        });

        // Try immediate upload if folderIso already present
        chrome.storage.local.get(['lastIngestResponse'], async (data) => {
          const folderIso = data?.lastIngestResponse?.folderIso || videoRecording.folderIso;
          if (folderIso && pendingVideoBlob) {
            await uploadVideoBlob(folderIso, pendingVideoBlob);
            pendingVideoBlob = null;
          }
        });
      } catch (e) {
        console.error('Processing video blob failed:', e);
      } finally {
        // Do not revoke here; offscreen page owns the blob URL
      }
    })();
    sendResponse?.({ ok: true });
    return true;
  }
  if (message.type === 'INGEST_DONE') {
    const { folderIso } = message;
    if (folderIso) videoRecording.folderIso = folderIso;
    (async () => {
      try {
        if (folderIso && pendingVideoBlob) {
          await uploadVideoBlob(folderIso, pendingVideoBlob);
          pendingVideoBlob = null;
        }
      } catch (e) {
        console.error('Deferred upload failed:', e);
      }
    })();
    sendResponse?.({ ok: true });
    return true;
  }
});

async function uploadVideoBlob(folderIso, blob) {
  try {
    const form = new FormData();
    form.append('folderIso', folderIso);
    form.append('file', new File([blob], 'video.webm', { type: 'video/webm' }));
    const headers = { ...API_KEY_HEADER };
    const resp = await fetch(`${API_BASE}/api/events/video`, {
      method: 'POST',
      body: form,
      headers
    });
    if (!resp.ok) {
      const tx = await resp.text();
      throw new Error(tx || `HTTP ${resp.status}`);
    }
    const json = await resp.json().catch(() => ({}));
    const serverPath = json && json.path ? json.path : null;
    if (serverPath) {
      // Persist on the last completed task for display in details
      chrome.storage.local.get(['taskHistory','lastCompletedTaskId'], (data) => {
        const taskId = data.lastCompletedTaskId;
        if (taskId && data.taskHistory && data.taskHistory[taskId]) {
          data.taskHistory[taskId].video_server_path = serverPath;
          if (videoRecording.localPath) {
            data.taskHistory[taskId].video_local_path = videoRecording.localPath;
          }
          chrome.storage.local.set({ taskHistory: data.taskHistory });
        }
      });
    }
  } catch (err) {
    console.error('Video upload error:', err);
  }
}

// Listen for events from recorder.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'recordedEvent') {
    console.log("Received recorded event:", {
      type: message.event.type,
      target: {
        tag: message.event.target.tag,
        id: message.event.target.id,
        bid: message.event.target.bid,
        isInteractive: message.event.target.isInteractive
      },
      timestamp: new Date(message.event.timestamp).toISOString()
    });
    
    // Get current task info
    chrome.storage.local.get(['isRecording', 'currentTaskId', 'taskHistory', 'videoStartedAtMs'], (data) => {
      if (data.isRecording && data.currentTaskId && data.taskHistory) {
        const taskHistory = data.taskHistory;
        const taskId = data.currentTaskId;
        
        if (taskHistory[taskId]) {
          const events = taskHistory[taskId].events || [];
          
          // Add the event to the task history
          // Add relative timestamp aligned to video start
          let relative = null;
          if (videoRecording.startedAtMs || data.videoStartedAtMs) {
            const base = videoRecording.startedAtMs || data.videoStartedAtMs;
            relative = Math.max(0, Number(message.event.timestamp) - Number(base));
          }
          // Add exact video timestamp key as requested
          const eventWithRelative = relative != null ? { 
            ...message.event, 
            videoTimeMs: relative, 
            video_timestamp: relative,
            video_event_start_ms: relative,
            video_event_end_ms: relative
          } : message.event;
          events.push(eventWithRelative);
          taskHistory[taskId].events = events;
          
          // Save updated task history
          chrome.storage.local.set({ taskHistory: taskHistory }, () => {
            console.log("Event saved to task history:", { type: message.event.type, totalEvents: events.length });
          });
        }
      }
    });
  } else if (message.action === "viewTaskDetails") {
    // Manifest V3 background scripts cannot use DOM APIs.
    // Open a new tab to details.html and pass the taskId as a query parameter.
    chrome.tabs.create({
      url: `details.html?taskId=${message.taskId}`
    });
    // The UI for viewing and filtering events should be implemented in details.html/details.js
  } else if (message.action === "exportTask") {
    chrome.storage.local.get(['taskHistory'], (data) => {
      const taskHistory = data.taskHistory || {};
      const task = taskHistory[message.taskId];
      
      if (task) {
        // Create a download link for the task data
        const taskData = JSON.stringify(task, null, 2);
        const blob = new Blob([taskData], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        
        chrome.downloads.download({
          url: url,
          filename: `task_${message.taskId}.json`,
          saveAs: true
        });
      }
    });
  } else if (message.action === "deleteTask") {
    chrome.storage.local.get(['taskHistory'], (data) => {
      const taskHistory = data.taskHistory || {};
      
      if (taskHistory[message.taskId]) {
        delete taskHistory[message.taskId];
        
        chrome.storage.local.set({ taskHistory: taskHistory }, function() {
          console.log("Task deleted:", message.taskId);
        });
      }
    });
  }
  
  return true; // Required for async sendResponse
});

// Listen for tab updates (including URL changes)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    // Check if we're recording and this is the recording tab
    chrome.storage.local.get(['isRecording', 'recordingTabId', 'currentTaskId', 'taskHistory', 'videoStartedAtMs'], (data) => {
      if (data.isRecording && data.recordingTabId === tabId && data.currentTaskId) {
        console.log("Navigation detected in recording tab:", tab.url);
        
        // Create navigation event
        const navigationEvent = {
          type: 'navigation',
          toUrl: tab.url,
          timestamp: Date.now(),
          title: tab.title || '',
          fromUserInput: changeInfo.url ? true : false // Best guess if it was from URL bar
        };
        
        // Save to task history
        if (data.taskHistory && data.currentTaskId) {
          const taskHistory = data.taskHistory;
          const taskId = data.currentTaskId;
          
          if (taskHistory[taskId]) {
            const events = taskHistory[taskId].events || [];
            // Align navigation relative time if available
            let relative = null;
            if (videoRecording.startedAtMs || data.videoStartedAtMs) {
              const base = videoRecording.startedAtMs || data.videoStartedAtMs;
              relative = Math.max(0, Number(navigationEvent.timestamp) - Number(base));
            }
            const navWithRelative = relative != null ? { 
              ...navigationEvent, 
              videoTimeMs: relative, 
              video_timestamp: relative,
              video_event_start_ms: relative,
              video_event_end_ms: relative
            } : navigationEvent;
            events.push(navWithRelative);
            taskHistory[taskId].events = events;
            
            chrome.storage.local.set({ taskHistory: taskHistory });
          }
        }
        
        // Inject recorder script into the new page
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['recorder.js']
        }).catch(err => console.error("Script injection error:", err));
      }
    });
  }
});

// Listen for tab creation (new tab)
chrome.tabs.onCreated.addListener((tab) => {
  chrome.storage.local.get(['isRecording', 'currentTaskId', 'taskHistory'], (data) => {
    if (data.isRecording && data.currentTaskId) {
      // Update the recording tab ID to the new tab
      chrome.storage.local.set({ recordingTabId: tab.id });
      
      // Record tab creation event
      const tabEvent = {
        type: 'newTab',
        timestamp: Date.now(),
        tabId: tab.id
      };
      
      // Save to task history
      if (data.taskHistory && data.currentTaskId) {
        const taskHistory = data.taskHistory;
        const taskId = data.currentTaskId;
        
        if (taskHistory[taskId]) {
          const events = taskHistory[taskId].events || [];
          events.push(tabEvent);
          taskHistory[taskId].events = events;
          
          chrome.storage.local.set({ taskHistory: taskHistory });
        }
      }
    }
  });
});
