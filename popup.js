// Add this function to check storage
function checkStorage() {
  chrome.storage.local.get(null, function(data) {
    console.log("All storage data:", data);
  });
}

let mediaRecorder;
let recordedChunks = [];

// Function to start screen recording
async function startScreenRecording() {
  console.log('Starting screen recording process...');
  
  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log('Active tab:', tab);

    // Request screen capture using Chrome's extension API
    const streamId = await new Promise((resolve) => {
      chrome.desktopCapture.chooseDesktopMedia(
        ['screen', 'window', 'tab'],
        tab,
        (streamId) => {
          if (chrome.runtime.lastError) {
            console.error('Error getting stream ID:', chrome.runtime.lastError);
            resolve(null);
          } else {
            resolve(streamId);
          }
        }
      );
    });

    if (!streamId) {
      throw new Error('Failed to get screen capture stream ID');
    }

    console.log('Got stream ID:', streamId);

    // Get the stream using the stream ID
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId
        }
      }
    });

    console.log('Screen capture stream obtained');

    // Create a video element to preview the stream
    const previewVideo = document.createElement('video');
    previewVideo.srcObject = stream;
    previewVideo.style.display = 'none';
    document.body.appendChild(previewVideo);
    
    // Start the preview
    await previewVideo.play();
    console.log('Preview started');

    // Create MediaRecorder with Chrome-specific options
    const mimeType = 'video/webm;codecs=vp9';
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: mimeType,
      videoBitsPerSecond: 2500000
    });
    
    recordedChunks = [];
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };
    
    // Start recording
    mediaRecorder.start(1000); // Capture data every second
    console.log('MediaRecorder started');
    
    // Store the stream and video element for cleanup
    window.screenStream = stream;
    window.previewVideo = previewVideo;
    
    return true;
  } catch (error) {
    console.error("Error in startScreenRecording:", error);
    console.error("Error stack:", error.stack);
    alert("Failed to start screen recording: " + error.message);
    return false;
  }
}

// Function to store video in IndexedDB
async function storeVideoInIndexedDB(taskId, videoBlob) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('TaskVideos', 1);
    
    request.onerror = () => reject(request.error);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('videos')) {
        db.createObjectStore('videos');
      }
    };
    
    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(['videos'], 'readwrite');
      const store = transaction.objectStore('videos');
      
      const saveRequest = store.put(videoBlob, taskId);
      
      saveRequest.onsuccess = () => {
        db.close();
        resolve();
      };
      
      saveRequest.onerror = () => {
        db.close();
        reject(saveRequest.error);
      };
    };
  });
}

// Function to stop screen recording
function stopScreenRecording() {
  console.log('Stopping screen recording...');
  
  return new Promise((resolve) => {
    if (!mediaRecorder) {
      console.warn('No MediaRecorder instance found');
      resolve(null);
      return;
    }
    
    mediaRecorder.onstop = async () => {
      console.log('MediaRecorder stopped, creating blob...');
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      console.log('Blob created, size:', blob.size, 'bytes');
      
      // Clean up
      console.log('Cleaning up resources...');
      if (window.screenStream) {
        console.log('Stopping screen stream tracks...');
        window.screenStream.getTracks().forEach(track => {
          console.log('Stopping track:', track.kind);
          track.stop();
        });
        window.screenStream = null;
      }
      
      if (window.previewVideo) {
        console.log('Removing preview video element...');
        window.previewVideo.remove();
        window.previewVideo = null;
      }
      
      console.log('Screen recording cleanup completed');
      resolve(blob);
    };
    
    console.log('Stopping MediaRecorder...');
    mediaRecorder.stop();
  });
}

// Call it when popup opens
document.addEventListener('DOMContentLoaded', async () => {
  console.log("Popup opened");
  checkStorage();
  
  chrome.storage.local.get(['isRecording', 'recordingStartTime'], (data) => {
    if (data.isRecording) {
      // We're already recording, update UI
      document.getElementById('startTask').disabled = true;
      document.getElementById('endTask').disabled = false;
      
      // Start timer
      if (data.recordingStartTime) {
        startTimer(data.recordingStartTime);
      }
    }
  });
});

// Add timer element
const timerElement = document.createElement('div');
timerElement.id = 'timer';
timerElement.style.margin = '10px 0';
timerElement.style.fontSize = '18px';
timerElement.style.textAlign = 'center';
document.querySelector('h1').after(timerElement);

let timerInterval;

function startTimer(startTime) {
  const updateTimer = () => {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    timerElement.textContent = `Time: ${minutes}:${seconds.toString().padStart(2, '0')}`;
  };
  
  // Clear any existing timer
  if (timerInterval) clearInterval(timerInterval);
  
  // Update immediately and then every second
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

document.getElementById('startTask').addEventListener('click', async () => {
  try {
    // Disable start button, enable end button
    document.getElementById('startTask').disabled = true;
    document.getElementById('endTask').disabled = false;
    
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Check if we can inject scripts into this tab
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('brave://')) {
      console.error("Cannot inject scripts into browser pages");
      alert("Cannot record on browser pages. Please navigate to a website first.");
      return;
    }

    // Generate a unique task ID
    const taskId = 'task_' + Date.now();
    window.currentTaskId = taskId;
    const startTime = Date.now();
    
    // Initialize a new task record
    const data = await chrome.storage.local.get(['taskHistory']);
    const taskHistory = data.taskHistory || {};
    
    // Create a new task entry
    taskHistory[taskId] = {
      id: taskId,
      startTime: startTime,
      events: [],
      status: 'recording',
      startUrl: tab.url,
      title: document.getElementById('taskDescription').textContent || 'Untitled Task',
      hasVideo: true
    };
    
    // Save the updated task history
    await chrome.storage.local.set({ 
      taskHistory: taskHistory,
      currentTaskId: taskId,
      isRecording: true,
      recordingStartTime: startTime,
      recordingTabId: tab.id
    });
    
    console.log("New task started:", taskId);

    // Start screen recording
    const recordingStarted = await startScreenRecording();
    if (!recordingStarted) {
      alert("Failed to start screen recording. Please ensure you grant screen capture permissions.");
      return;
    }

    // Inject the recorder script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Reset the initialization flag
        window.taskRecorderInitialized = false;
      }
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['recorder.js']
    });

    // Send message to start recording and wait for response
    try {
      const response = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Timeout waiting for start recording response'));
        }, 5000); // 5 second timeout

        chrome.tabs.sendMessage(tab.id, { 
          action: "startRecording",
          taskId: taskId
        }, (response) => {
          clearTimeout(timeoutId);
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        });
      });

      if (!response || response.status !== "recording started") {
        throw new Error("Failed to start recording properly");
      }
    } catch (error) {
      console.error("Error starting recording:", error);
      throw error;
    }
    
    // Start timer
    startTimer(startTime);
  } catch (error) {
    console.error("Error in startTask click handler:", error);
    console.error("Error stack:", error.stack);
    alert("Error: " + error.message);
    // Reset buttons
    document.getElementById('startTask').disabled = false;
    document.getElementById('endTask').disabled = true;
  }
});

document.getElementById('endTask').addEventListener('click', async () => {
  console.log('End Task button clicked');
  
  try {
    // Disable end button, enable start button
    document.getElementById('endTask').disabled = true;
    document.getElementById('startTask').disabled = false;
    console.log('Button states updated');
    
    // Clear timer
    if (timerInterval) {
      console.log('Clearing timer interval');
      clearInterval(timerInterval);
      timerElement.textContent = '';
    }
    
    // Get current task ID and tab ID first
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const data = await chrome.storage.local.get(['currentTaskId', 'recordingTabId', 'taskHistory']);
    const taskId = data.currentTaskId;
    
    if (data.recordingTabId) {
      try {
        // Send message to stop recording and wait for response
        const response = await new Promise((resolve, reject) => {
          let hasResponded = false;
          
          const timeoutId = setTimeout(() => {
            if (!hasResponded) {
              hasResponded = true;
              console.warn("Stop recording timeout - forcing stop");
              resolve({ status: "recording force stopped due to timeout" });
            }
          }, 4000);

          chrome.tabs.sendMessage(data.recordingTabId, { action: "stopRecording" }, (response) => {
            if (!hasResponded) {
              hasResponded = true;
              clearTimeout(timeoutId);
              if (chrome.runtime.lastError) {
                console.error("Error sending stop message:", chrome.runtime.lastError);
                resolve({ status: "recording force stopped due to error" });
              } else {
                console.log("Stop recording response:", response);
                resolve(response || { status: "recording force stopped" });
              }
            }
          });
        });

        console.log("Final stop recording response:", response);
        
        // Update task status regardless of response
        if (taskId && data.taskHistory && data.taskHistory[taskId]) {
          const taskHistory = data.taskHistory;
          taskHistory[taskId].status = 'completed';
          taskHistory[taskId].endTime = Date.now();
          taskHistory[taskId].hasVideo = true;
          taskHistory[taskId].endUrl = tab.url;
          
          await chrome.storage.local.set({ 
            taskHistory: taskHistory,
            isRecording: false,
            recordingStartTime: null,
            recordingTabId: null,
            currentTaskId: null
          });
        }
      } catch (e) {
        console.error("Error in stop recording process:", e);
        // Continue with cleanup even if stop message fails
      }
    }
    
    console.log('Stopping screen recording...');
    // Stop screen recording and get the video blob
    const videoBlob = await stopScreenRecording();
    console.log('Screen recording stopped, storing video...');
    
    if (videoBlob) {
      // Store video in IndexedDB
      await storeVideoInIndexedDB(taskId, videoBlob);
      console.log('Video stored in IndexedDB');
    }
    
    if (taskId && data.taskHistory && data.taskHistory[taskId]) {
      // Show task summary
      showTaskSummary(taskId, data.taskHistory[taskId]);
    }
  } catch (error) {
    console.error("Error in endTask click handler:", error);
    console.error("Error stack:", error.stack);
    alert("Error: " + error.message);
  }
});

// Function to show task summary
function showTaskSummary(taskId, taskData) {
  // Create or get the results container
  let resultsDiv = document.getElementById('results');
  if (!resultsDiv) {
    resultsDiv = document.createElement('div');
    resultsDiv.id = 'results';
    document.body.appendChild(resultsDiv);
  }
  
  // Clear previous results
  resultsDiv.innerHTML = '';
  
  // Create summary header
  const header = document.createElement('h2');
  header.textContent = 'Task Summary';
  resultsDiv.appendChild(header);
  
  // Add task details
  const details = document.createElement('div');
  const duration = Math.floor((taskData.endTime - taskData.startTime) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  
  details.innerHTML = `
    <p><strong>Task:</strong> ${taskData.title}</p>
    <p><strong>Duration:</strong> ${minutes}m ${seconds}s</p>
    <p><strong>Events recorded:</strong> ${taskData.events.length}</p>
    <p><strong>Start URL:</strong> ${taskData.startUrl}</p>
    <p><strong>End URL:</strong> ${taskData.endUrl}</p>
  `;
  resultsDiv.appendChild(details);
  
  // Add screen recording if available
  if (taskData.screenRecordingUrl) {
    const videoContainer = document.createElement('div');
    videoContainer.style.marginTop = '20px';
    videoContainer.innerHTML = `
      <h3>Screen Recording</h3>
      <video controls style="width: 100%; max-width: 800px;">
        <source src="${taskData.screenRecordingUrl}" type="video/webm">
        Your browser does not support the video tag.
      </video>
    `;
    resultsDiv.appendChild(videoContainer);
  }
  
  // Add view details button
  const viewButton = document.createElement('button');
  viewButton.textContent = 'View Detailed Events';
  viewButton.addEventListener('click', () => {
    // Create a new window with proper CSP headers
    const detailWindow = window.open('', 'Task Details', 'width=800,height=600');
    
    // Write the HTML structure
    detailWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Task Details</title>
          <style>
            body { font-family: monospace; white-space: pre; padding: 20px; }
          </style>
        </head>
        <body>
          <h1>Task Details: ${taskData.title}</h1>
          <pre id="eventData"></pre>
        </body>
      </html>
    `);
    
    // Close the document write stream
    detailWindow.document.close();
    
    // Set the event data after the document is ready
    detailWindow.document.getElementById('eventData').textContent = 
      JSON.stringify(taskData.events, null, 2);
  });
  
  resultsDiv.appendChild(viewButton);
}

// Function to view task history
function addTaskHistoryButton() {
  const historyButton = document.createElement('button');
  historyButton.textContent = 'View Task History';
  historyButton.style.marginTop = '10px';
  historyButton.style.backgroundColor = '#4CAF50';
  historyButton.style.color = 'white';
  historyButton.style.width = '100%';
  
  historyButton.addEventListener('click', () => {
    chrome.storage.local.get(['taskHistory'], (data) => {
      const taskHistory = data.taskHistory || {};
      
      // Create a new window
      const historyWindow = window.open('', 'Task History', 'width=800,height=600');
      
      // Write the HTML structure
      historyWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Task History</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 20px; }
              .task { border: 1px solid #ddd; padding: 10px; margin-bottom: 10px; border-radius: 5px; }
              .task:hover { background-color: #f5f5f5; }
              .task-header { display: flex; justify-content: space-between; }
              .task-title { font-weight: bold; }
              .task-details { margin-top: 10px; }
              button { padding: 5px 10px; margin-right: 5px; cursor: pointer; }
            </style>
          </head>
          <body>
            <h1>Task History</h1>
            <div id="taskList">Loading...</div>
          </body>
        </html>
      `);
      
      // Close the document write stream
      historyWindow.document.close();
      
      // Get the task list container
      const taskList = historyWindow.document.getElementById('taskList');
      
      if (Object.keys(taskHistory).length === 0) {
        taskList.innerHTML = '<p>No tasks recorded yet.</p>';
      } else {
        // Sort tasks by start time (newest first)
        const sortedTasks = Object.values(taskHistory).sort((a, b) => b.startTime - a.startTime);
        
        // Create task elements
        sortedTasks.forEach(task => {
          const duration = task.endTime ? Math.floor((task.endTime - task.startTime) / 1000) : 'In progress';
          const formattedDuration = typeof duration === 'number' ? 
            `${Math.floor(duration / 60)}m ${duration % 60}s` : duration;
          
          const taskElement = document.createElement('div');
          taskElement.className = 'task';
          taskElement.dataset.taskId = task.id;
          
          taskElement.innerHTML = `
            <div class="task-header">
              <span class="task-title">${task.title}</span>
              <span class="task-date">${new Date(task.startTime).toLocaleString()}</span>
            </div>
            <div class="task-details">
              <p><strong>Status:</strong> ${task.status}</p>
              <p><strong>Duration:</strong> ${formattedDuration}</p>
              <p><strong>Events:</strong> ${task.events ? task.events.length : 0}</p>
              <button class="view-details">View Details</button>
              <button class="export-task">Export</button>
              <button class="delete-task" style="background-color: #f44336; color: white;">Delete</button>
            </div>
          `;
          
          // Add event listeners
          taskElement.querySelector('.view-details').addEventListener('click', () => {
            chrome.runtime.sendMessage({action: "viewTaskDetails", taskId: task.id});
          });
          
          taskElement.querySelector('.export-task').addEventListener('click', () => {
            chrome.runtime.sendMessage({action: "exportTask", taskId: task.id});
          });
          
          taskElement.querySelector('.delete-task').addEventListener('click', () => {
            if (confirm("Are you sure you want to delete this task?")) {
              chrome.runtime.sendMessage({action: "deleteTask", taskId: task.id});
              taskElement.remove();
            }
          });
          
          taskList.appendChild(taskElement);
        });
      }
    });
  });
  
  // Add the button to the popup
  document.body.appendChild(historyButton);
}

// Call this function when the popup is loaded
document.addEventListener('DOMContentLoaded', function() {
  addTaskHistoryButton();
});
