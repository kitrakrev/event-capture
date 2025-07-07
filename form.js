const toggle = document.getElementById('recordToggle');
    toggle.addEventListener('click', () => {
      const isOn = toggle.dataset.recordVideo === 'true';
      toggle.dataset.recordVideo = (!isOn).toString();
      toggle.textContent = 'Record Video: ' + (!isOn ? 'On' : 'Off');
      toggle.classList.toggle('on', !isOn);
    });

    document.getElementById('startRecording').addEventListener('click', () => {
      const name = document.getElementById('taskName').value.trim();
      const desc = document.getElementById('taskDesc').value.trim();
      if (!name || !desc) {
        alert('Please fill out both name and description.');
        return;
      }
      const recordVideo = toggle.dataset.recordVideo === 'true';
      const id = `${Date.now()}-${Math.floor(Math.random()*1e6)}`;
      const taskDetails = {
        id,
        name,
        description: desc,
        recordVideo,
        startedAt: new Date().toISOString()
      };

      // Send task details to background.js
      chrome.runtime.sendMessage(
        { action: 'startTask', task: taskDetails },
        response => {
          if (chrome.runtime.lastError) {
            console.error('Failed to send task details:', chrome.runtime.lastError.message);
            alert('Error starting task');
          } else {
            alert('Task started!');
            window.close();
          }
        }
      );
    });