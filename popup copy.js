// Add this function to check storage
function checkStorage() {
  chrome.storage.local.get(null, function(data) {
    console.log("All storage data:", data);
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
      console.error("Cannot inject scripts into browser pages. Please navigate to a website first.");
      alert("Cannot record on browser pages. Please navigate to a website first.");
      return;
    }
    
    // Generate a unique task ID
    const taskId = 'task_' + Date.now();
    const startTime = Date.now();
    
    // Initialize a new task record
    chrome.storage.local.get(['taskHistory'], function(data) {
      const taskHistory = data.taskHistory || {};
      
      // Create a new task entry
      taskHistory[taskId] = {
        id: taskId,
        startTime: startTime,
        events: [],
        status: 'recording',
        startUrl: tab.url,
        title: document.getElementById('taskDescription').textContent || 'Untitled Task'
      };
      
      // Save the updated task history
      chrome.storage.local.set({ 
        taskHistory: taskHistory,
        currentTaskId: taskId,
        isRecording: true,
        recordingStartTime: startTime,
        recordingTabId: tab.id
      }, function() {
        console.log("New task started:", taskId);
      });
    });
    
    // Start timer
    startTimer(startTime);
    
    // Inject content script to record user actions
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['recorder.js']
    });
    
    // Send message to start recording
    // chrome.tabs.sendMessage(tab.id, { action: "startRecording", taskId: taskId });
    chrome.runtime.sendMessage({ action: "initiateRecording", taskId: taskId }); // changed from tabs to runtime

  } catch (error) {
    console.error("Error starting recording:", error);
    alert("Error: " + error.message);
    // Reset buttons
    document.getElementById('startTask').disabled = false;
    document.getElementById('endTask').disabled = true;
  }
});

document.getElementById('endTask').addEventListener('click', async () => {
  try {
    // Disable end button, enable start button
    document.getElementById('endTask').disabled = true;
    document.getElementById('startTask').disabled = false;
    
    // Clear timer
    if (timerInterval) clearInterval(timerInterval);
    timerElement.textContent = '';
    
    // Get current task ID
    chrome.storage.local.get(['currentTaskId', 'recordingTabId', 'taskHistory'], async (data) => {
      const taskId = data.currentTaskId;
      
      if (taskId && data.taskHistory && data.taskHistory[taskId]) {
        // Update task status
        const taskHistory = data.taskHistory;
        taskHistory[taskId].status = 'completed';
        taskHistory[taskId].endTime = Date.now();
        
        // Get the current tab to record the end URL
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        taskHistory[taskId].endUrl = tab.url;
        
        // Save the updated task history
        chrome.storage.local.set({ 
          taskHistory: taskHistory,
          isRecording: false,
          recordingStartTime: null,
          recordingTabId: null,
          currentTaskId: null
        });
        
        console.log("Task completed:", taskId);
        
        // Show task summary
        showTaskSummary(taskId, taskHistory[taskId]);
      }
      
      if (data.recordingTabId) {
        chrome.runtime.sendMessage({ action: "stopRecording" });
        try {
          // Send message to stop recording
          // chrome.tabs.sendMessage(data.recordingTabId, { action: "stopRecording" });
          // chrome.runtime.sendMessage({ action: "stopRecording" }); // changed from tabs to runtime
        } catch (e) {
          console.error("Error sending stop message:", e);
        }
      }
    });
  } catch (error) {
    console.error("Error stopping recording:", error);
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
            <button id="clearAllTasks">Clear All Tasks</button>
            <div id="taskList">Loading...</div>
          </body>
        </html>
      `);
      
      // Close the document write stream
      historyWindow.document.close();
      
      // Get the task list container
      const taskList = historyWindow.document.getElementById('taskList');
      const clearAllTasks = historyWindow.document.getElementById('clearAllTasks');
      clearAllTasks.addEventListener('click', () => {
        chrome.storage.local.set({ taskHistory: {} }, function() {
          console.log("All tasks cleared");
          taskList.innerHTML = '<p>No tasks recorded yet.</p>';
        });
        // refresh contents
        taskList.innerHTML = '<p>No tasks recorded yet.</p>';
      }
    );
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
