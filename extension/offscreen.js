// Offscreen document script: records whole screen to a WebM blob
let mediaRecorder = null;
let recordedChunks = [];
let startedAtMs = null;
let stream = null;

async function startRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') return;
  recordedChunks = [];
  startedAtMs = Date.now();
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'monitor', frameRate: 30 },
      audio: false
    });
    // Add fallback for browsers that don't support vp9
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const blobUrl = URL.createObjectURL(blob);
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_BLOB_READY', blobUrl });
      } catch (e) {
        console.error('Blob finalize failed', e);
      }
      try { stream.getTracks().forEach(t => t.stop()); } catch {}
      stream = null;
    };
    mediaRecorder.start(250); // small timeslice for reliability
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_STARTED', startedAtMs });
  } catch (e) {
    console.error('getDisplayMedia failed', e);
    throw e;
  }
}

async function stopRecording() {
  try {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  } finally {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOPPED' });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OFFSCREEN_START') {
    startRecording().then(() => sendResponse({ ok: true, startedAtMs })).catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg.type === 'OFFSCREEN_STOP') {
    stopRecording().then(() => sendResponse({ ok: true })).catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});


