// Parse taskId from URL
const urlParams = new URLSearchParams(window.location.search);
const taskId = urlParams.get('taskId');

document.getElementById('eventData').textContent = 'Loading...';
document.getElementById('eventCount').textContent = '';

async function pushToMongoDB(data) {
  try {
    const response = await fetch('https://4ba7541c-d467-4d08-ac05-8531ce5b74a4-00-2mvyzjzumqrkj.riker.replit.dev/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'omit', // Don't send credentials
      body: JSON.stringify({
        taskId: taskId,
        events: data
      })
    });

    const result = await response.json();
    
    if (response.ok) {
      alert('Data successfully pushed to MongoDB!');
    } else {
      throw new Error(result.error || 'Failed to push data');
    }
  } catch (error) {
    console.error('Error pushing to MongoDB:', error);
    alert('Error pushing to MongoDB: ' + error.message);
  }
}

document.addEventListener('DOMContentLoaded', function() {
  chrome.storage.local.get(['taskHistory'], (data) => {
    const task = data.taskHistory?.[taskId];
    if (!task) {
      document.getElementById('taskTitle').textContent = 'Task not found';
      document.getElementById('eventData').textContent = '';
      return;
    }

    document.getElementById('taskTitle').textContent = task.title;
    const events = task.events || [];
    const eventTypes = Array.from(new Set(events.map(e => e.type))).sort();

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
      document.getElementById('eventData').textContent = filtered.map(event => {
        const timestamp = new Date(event.timestamp).toLocaleString();
        return `[${timestamp}] ${event.type}\n${JSON.stringify(event.target, null, 2)}\n`;
      }).join('\n');
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

    // Add MongoDB push button event listener
    document.getElementById('pushToMongoBtn').addEventListener('click', function() {
      pushToMongoDB(events);
    });

    renderEvents();
  });
}); 