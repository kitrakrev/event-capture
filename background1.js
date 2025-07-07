chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) {
    // Extension was just updated
    reloadAllTabs();
  }
});
function reloadAllTabs() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      // skip chrome:// and extension pages
      if (!tab.url.startsWith('chrome://') &&
          !tab.url.startsWith('edge://') &&
          !tab.url.startsWith('chrome-extension://')) {
        chrome.tabs.reload(tab.id);
      }
    }
  });
}



chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install' || details.reason === 'update') {
    chrome.tabs.query({ url: ['<all_urls>'] }, tabs => {
      for (const t of tabs) {
        chrome.scripting.executeScript({
          target: { tabId: t.id },
          files: ['recorder.js']
        }).catch(console.error);
      }
    });
  }
});
// Track navigation events
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {

    if (tab.url && tab.url.startsWith('chrome-extension://')) {
      return;
    }
    // Check if we're recording
    chrome.storage.local.get(['isRecording', 'recordingTabId'], (data) => {
      if (data.isRecording && data.recordingTabId === tabId) {
        console.log("Navigation detected in recording tab:", tab.url);
        
        // Inject recorder script into the new page
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['recorder.js']
        }).catch(err => console.error("Script injection error:", err));
      }
    });
  }
});

// Listen for events from recorder.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message.action == "initiateRecording"){
    startScreenCapture(message.taskId);
    sendResponse({status: "recording started"});
  }
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
    }
  );
    
    // Get current task info
    chrome.storage.local.get(['isRecording', 'currentTaskId', 'taskHistory'], (data) => {
      if (data.isRecording && data.currentTaskId && data.taskHistory) {
        const taskHistory = data.taskHistory;
        const taskId = data.currentTaskId;
        
        if (taskHistory[taskId]) {
          const events = taskHistory[taskId].events || [];
          
          // Add the event to the task history
          events.push(message.event);
          taskHistory[taskId].events = events;
          
          // Save updated task history
          chrome.storage.local.set({ taskHistory: taskHistory }, () => {
            console.log("Event saved to task history:", {
              type: message.event.type,
              totalEvents: events.length,
              timestamp: new Date(message.event.timestamp).toISOString()
            });
          });
        }
      }
    }
  
  ); sendResponse({status: "recording event received"});
  } else if (message.action === "viewTaskDetails") {
    // Manifest V3 background scripts cannot use DOM APIs.
    // Open a new tab to details.html and pass the taskId as a query parameter.
    chrome.tabs.create({
      url: `details.html?taskId=${message.taskId}`
    });
    sendResponse({status: "task details viewed"});
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
    sendResponse({status: "task exported"});
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
    sendResponse({status: "task deleted"});
  }
  
  return true; // Required for async sendResponse
});

// Listen for tab updates (including URL changes)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    
    if (tab.url && tab.url.startsWith('chrome-extension://')) {
      return;
    }
    // Check if we're recording and this is the recording tab
    chrome.storage.local.get(['isRecording', 'recordingTabId', 'currentTaskId', 'taskHistory'], (data) => {
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
            events.push(navigationEvent);
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




const startScreenCapture = async (taskId) => {
  await chrome.tabs.query({'active': true, 'lastFocusedWindow': true, 'currentWindow': true}, async function (tabs) {
    // Get current tab to focus on it after start recording on recording screen tab
    const currentTab = tabs[0];

    // Create recording screen tab
    const tab = await chrome.tabs.create({
      url: chrome.runtime.getURL('screencapture.html'),
      pinned: true,
      active: true,
    });

    // Wait for recording screen tab to be loaded and send message to it with the currentTab
    chrome.tabs.onUpdated.addListener(async function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        await chrome.tabs.sendMessage(tabId, {
          action: 'startScreenCapture',
          taskId: taskId,
          body: {
            currentTab: currentTab,
          },
        });
      }
    });
  });
};

