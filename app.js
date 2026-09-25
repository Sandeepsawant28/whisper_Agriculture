/**
 * Konkani Voice AI Studio - Frontend Controller
 * Communicates with the Whisper Small LoRA Flask backend via plain fetch().
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  if (window.lucide) {
    lucide.createIcons();
  }

  // --- BACKEND CONFIG ---
  const BACKEND_URL = "http://localhost:5000";

  // --- SILENCE-BASED CHUNKING CONFIG ---
  // Instead of cutting audio every fixed N seconds, we cut a chunk when
  // the speaker pauses (silence) for SILENCE_DURATION_MS or longer, OR when
  // MAX_CHUNK_DURATION_MS is hit even without a pause. Lowered both from the
  // original 5000ms/20000ms so chunks get sent every few seconds instead of
  // only at the end of long continuous speech.
  const SILENCE_DURATION_MS = 1200;    // 1.2s of silence -> cut chunk here
  const MIN_CHUNK_DURATION_MS = 600;   // ignore tiny fragments shorter than this
  const MAX_CHUNK_DURATION_MS = 4000;  // safety cap: force-cut every 4s even with no pause
  const SILENCE_MARGIN = 12;           // how far above ambient floor still counts as "silence"

  // DOM Elements
  const btnToggleMic = document.getElementById('btn-toggle-mic');
  const micIcon = document.getElementById('mic-icon');
  const micBtnWrapper = document.getElementById('mic-btn-wrapper');
  const recTimer = document.getElementById('rec-timer');
  const recordHint = document.getElementById('record-hint');
  const deckStatusBadge = document.getElementById('deck-status-badge');
  const liveRecDot = document.getElementById('live-rec-dot');
  const vuMeterFill = document.getElementById('vu-meter-fill');
  const noiseLockBadge = document.getElementById('noise-lock-badge');

  // File Upload Elements
  const fileDropZone = document.getElementById('file-drop-zone');
  const audioFileInput = document.getElementById('audio-file-input');
  const dropZoneTrigger = document.getElementById('drop-zone-trigger');
  const uploadedFilePreview = document.getElementById('uploaded-file-preview');
  const previewFileName = document.getElementById('preview-file-name');
  const previewAudioPlayer = document.getElementById('preview-audio-player');
  const btnRemoveFile = document.getElementById('btn-remove-file');
  const btnTranscribeFile = document.getElementById('btn-transcribe-file');
  const transcribeBtnLabel = document.getElementById('transcribe-btn-label');

  const serverStatusPill = document.getElementById('server-status-pill');
  const serverStatusDot = document.getElementById('server-status-dot');
  const serverStatusText = document.getElementById('server-status-text');
  const btnCheckServer = document.getElementById('btn-check-server');

  const transcriptScrollBox = document.getElementById('transcript-scroll-box');
  const transcriptPlaceholder = document.getElementById('transcript-placeholder');
  const transcriptFeed = document.getElementById('transcript-feed');
  const ribbonTokensContainer = document.getElementById('ribbon-tokens-container');
  const typingCursor = document.getElementById('typing-cursor');

  const statWords = document.getElementById('stat-words');
  const statChars = document.getElementById('stat-chars');
  const statChunks = document.getElementById('stat-chunks');

  const btnCopyText = document.getElementById('btn-copy-text');
  const btnDownloadTxt = document.getElementById('btn-download-txt');
  const btnClearTranscript = document.getElementById('btn-clear-transcript');

  // Spoken Vault & Download Elements
  const vaultCountBadge = document.getElementById('vault-count-badge');
  const vaultSearchInput = document.getElementById('vault-search-input');
  const vaultSearchClear = document.getElementById('vault-search-clear');
  const btnExportAllTranscripts = document.getElementById('btn-export-all-transcripts');
  const btnClearVault = document.getElementById('btn-clear-vault');
  const vaultLiveBanner = document.getElementById('vault-live-banner');
  const vaultLiveSessionNum = document.getElementById('vault-live-session-num');
  const vaultLiveTimer = document.getElementById('vault-live-timer');
  const vaultStatTotal = document.getElementById('vault-stat-total');
  const vaultStatDuration = document.getElementById('vault-stat-duration');
  const vaultStatWords = document.getElementById('vault-stat-words');
  const vaultEmptyState = document.getElementById('vault-empty-state');
  const vaultCardsGrid = document.getElementById('vault-cards-grid');

  // Vault Modal & Header Menu Elements
  const btnOpenVault = document.getElementById('btn-open-vault');
  const btnCloseVault = document.getElementById('btn-close-vault');
  const vaultModalBackdrop = document.getElementById('vault-modal-backdrop');
  const headerVaultBadge = document.getElementById('header-vault-badge');

  // Background Noise Level Monitor Elements
  const noiseMonitorCard = document.getElementById('noise-monitor-card');
  const noiseBadge = document.getElementById('noise-badge');
  const noiseMeterFill = document.getElementById('noise-meter-fill');
  const noiseDbText = document.getElementById('noise-db-text');
  const noiseTrendBox = document.getElementById('noise-trend-box');
  const noiseTrendText = document.getElementById('noise-trend-text');
  const noiseAlertBanner = document.getElementById('noise-alert-banner');

  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toast-text');
  const toastIcon = document.getElementById('toast-icon');

  // Mobile Mode Switcher Elements
  const mobileModeSwitcher = document.getElementById('mobile-mode-switcher');
  const tabVoice = document.getElementById('tab-voice');
  const tabFile = document.getElementById('tab-file');
  const workspaceGrid = document.getElementById('workspace-grid');

  function setMobileViewMode(mode) {
    if (!workspaceGrid) return;
    if (mode === 'file') {
      workspaceGrid.classList.remove('mode-voice');
      workspaceGrid.classList.add('mode-file');
      if (tabFile) tabFile.classList.add('active');
      if (tabVoice) tabVoice.classList.remove('active');
    } else {
      workspaceGrid.classList.remove('mode-file');
      workspaceGrid.classList.add('mode-voice');
      if (tabVoice) tabVoice.classList.add('active');
      if (tabFile) tabFile.classList.remove('active');
    }
  }

  if (tabVoice) {
    tabVoice.addEventListener('click', () => setMobileViewMode('voice'));
  }
  if (tabFile) {
    tabFile.addEventListener('click', () => setMobileViewMode('file'));
  }
  // Initialize default view to voice (Mic at top, text down below)
  setMobileViewMode('voice');

  // State
  let isRecording = false;
  let micStream = null;
  let mediaRecorder = null;
  let audioChunksQueue = [];
  let recSeconds = 0;
  let recTimerInterval = null;

  // Silence-based chunking state (replaces the old fixed-interval timer)
  let silenceStartTime = null;
  let currentSliceStartTime = null;

  let audioCtx = null;
  let analyser = null;
  let animFrameId = null;

  let accumulatedText = [];
  let totalChunksTranscribed = 0;

  // Vault State
  let vaultRecordings = [];
  let currentSessionId = null;
  let currentSessionNum = 0;
  let currentSessionChunks = [];
  let currentSessionTexts = [];

  // --- TOAST NOTIFICATIONS ---
  let toastTimeout = null;
  function showToast(message, type = 'info') {
    if (!toast || !toastText) return;
    toastText.textContent = message;
    toast.className = `toast-popup show ${type}`;

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }

  // --- HEALTH CHECK PING (via Flask /health) ---
  async function checkServerHealth() {
    if (serverStatusText) serverStatusText.textContent = 'Checking Model...';
    try {
      const res = await fetch(`${BACKEND_URL}/health`);
      const data = await res.json();

      if (data && data.status === 'online') {
        serverStatusPill.className = 'status-pill';
        serverStatusText.textContent = `Whisper Online (${data.model || 'Konkani LoRA'})`;
        showToast('✓ Konkani Whisper Model Connected & Ready', 'success');
      } else {
        serverStatusPill.className = 'status-pill warning';
        serverStatusText.textContent = 'Model Loading...';
        showToast('Server online, model still loading weights.', 'warning');
      }
    } catch (err) {
      serverStatusPill.className = 'status-pill offline';
      serverStatusText.textContent = 'Backend Unreachable';
      showToast('⚠️ Could not reach the backend. Is whisper_server.py running?', 'error');
      console.error('Health check error:', err);
    }
  }

  if (btnCheckServer) {
    btnCheckServer.addEventListener('click', checkServerHealth);
  }
  // Initial check on page load
  checkServerHealth();

  // --- REAL-TIME AUDIO MONITOR & BACKGROUND NOISE BLOCKER ---
  let isNoiseBlocked = false;
  let noiseHistory = [];
  let ambientNoiseFloor = 8;
  let consecutiveIncreasingFrames = 0;
  let consecutiveHighNoiseFrames = 0;
  let lastSmoothedLevel = 0;

  function initAudioAnalysis(stream) {
    if (audioCtx && analyser) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
    } catch (e) {
      console.warn('AudioContext initialisation fallback:', e);
    }
  }

  function updateNoiseMonitor(currentRawAvg) {
    if (!noiseMeterFill || !noiseBadge) return;

    if (!analyser) {
      noiseMeterFill.style.width = '6%';
      if (noiseDbText) noiseDbText.textContent = '0 dB (Ready)';
      if (noiseBadge) {
        noiseBadge.className = 'noise-badge low';
        noiseBadge.textContent = 'Quiet (Optimal)';
      }
      if (noiseTrendText) noiseTrendText.textContent = 'Environment quiet • Ready to monitor';
      if (noiseAlertBanner) noiseAlertBanner.style.display = 'none';
      if (noiseMonitorCard) {
        noiseMonitorCard.classList.remove('high-alert', 'elevated');
      }
      return;
    }

    // Smooth the raw input level
    const smoothed = (lastSmoothedLevel * 0.65) + (currentRawAvg * 0.35);
    lastSmoothedLevel = smoothed;

    // Track rolling history (last 24 frames)
    noiseHistory.push(smoothed);
    if (noiseHistory.length > 24) noiseHistory.shift();

    // Moving average of recent audio volume
    const historySum = noiseHistory.reduce((a, b) => a + b, 0);
    const movingAvg = historySum / noiseHistory.length;

    // Adaptive noise floor tracking
    if (smoothed < ambientNoiseFloor) {
      ambientNoiseFloor = smoothed;
    } else {
      ambientNoiseFloor = (ambientNoiseFloor * 0.995) + (smoothed * 0.005);
    }

    // Normalized meter fill 0% to 100%
    const meterPercent = Math.min(100, Math.max(6, Math.round((smoothed / 160) * 100)));
    noiseMeterFill.style.width = `${meterPercent}%`;

    // Estimated current sound decibels (20 dB quiet room to 95 dB peak loud sound/voices)
    const estimatedDb = Math.min(95, Math.max(20, Math.round(20 + (smoothed / 160) * 75)));
    // Baseline ambient room noise floor in decibels
    const baselineDb = Math.min(95, Math.max(20, Math.round(20 + (ambientNoiseFloor / 160) * 75)));

    if (noiseDbText) noiseDbText.textContent = `${estimatedDb} dB`;

    // --- CASE 1: ACTIVELY RECORDING ---
    if (isRecording) {
      isNoiseBlocked = false;
      consecutiveHighNoiseFrames = 0;
      if (btnToggleMic) btnToggleMic.classList.remove('noise-blocked');
      if (noiseLockBadge) noiseLockBadge.style.display = 'none';
      if (noiseAlertBanner) noiseAlertBanner.style.display = 'none';
      if (noiseMonitorCard) {
        noiseMonitorCard.classList.remove('high-alert', 'elevated');
      }

      // --- SENTENCE-BOUNDARY DETECTION (silence-based chunking) ---
      // Cuts the current MediaRecorder slice when the speaker pauses for
      // SILENCE_DURATION_MS, instead of on a fixed timer. This keeps full
      // sentences intact and avoids mid-word chops that were producing
      // garbled/hallucinated transcription at chunk boundaries.
      const now = Date.now();
      const isSilentNow = smoothed <= (ambientNoiseFloor + SILENCE_MARGIN);
      const elapsedInSlice = currentSliceStartTime ? now - currentSliceStartTime : 0;

      if (isSilentNow) {
        if (silenceStartTime === null) silenceStartTime = now;
        const silenceElapsed = now - silenceStartTime;

        if (silenceElapsed >= SILENCE_DURATION_MS && elapsedInSlice >= MIN_CHUNK_DURATION_MS) {
          cutCurrentSlice();
        }
      } else {
        silenceStartTime = null;
      }

      // Safety cap — force a cut if speech runs on with no natural pause
      if (elapsedInSlice >= MAX_CHUNK_DURATION_MS) {
        cutCurrentSlice();
      }

      if (estimatedDb >= 55) {
        noiseBadge.className = 'noise-badge low';
        noiseBadge.textContent = 'Voice Active (Recording)';
        if (noiseTrendText) noiseTrendText.textContent = '🎙️ Konkani speech captured • Streaming to Whisper';
      } else {
        noiseBadge.className = 'noise-badge low';
        noiseBadge.textContent = isSilentNow ? 'Pause detected...' : 'Recording Live';
        if (noiseTrendText) {
          noiseTrendText.textContent = isSilentNow
            ? `Pause detected • Cutting sentence in ${Math.max(0, Math.ceil((SILENCE_DURATION_MS - (now - silenceStartTime)) / 1000))}s if silence continues`
            : 'Listening continuously for Konkani speech...';
        }
      }
      return;
    }

    // --- CASE 2: IDLE / PRE-RECORDING MONITORING ---
    const isRising = smoothed > (movingAvg * 1.35) && smoothed > 35;
    if (isRising) {
      consecutiveIncreasingFrames++;
    } else {
      consecutiveIncreasingFrames = Math.max(0, consecutiveIncreasingFrames - 1);
    }

    const isExcessiveNoise = estimatedDb >= 85 && (baselineDb >= 65 || smoothed >= 135);

    if (isExcessiveNoise) {
      consecutiveHighNoiseFrames++;
    } else {
      consecutiveHighNoiseFrames = Math.max(0, consecutiveHighNoiseFrames - 2);
    }

    if (consecutiveHighNoiseFrames >= 35) {
      isNoiseBlocked = true;
      if (deckStatusBadge && !isRecording) deckStatusBadge.textContent = 'LOUD NOISE';
      if (recordHint && !isRecording) recordHint.textContent = 'Loud environment (>85 dB) • Speak close to mic';

      noiseBadge.className = 'noise-badge high';
      noiseBadge.textContent = 'Loud (85+ dB)';
      if (noiseAlertBanner) {
        noiseAlertBanner.style.display = 'flex';
        const alertText = document.getElementById('noise-alert-text');
        if (alertText) {
          alertText.innerHTML = '<strong>High Noise Alert (85+ dB):</strong> High background noise detected. Speak clearly and close to the microphone for optimal Konkani transcription.';
        }
      }
      if (noiseMonitorCard) {
        noiseMonitorCard.classList.add('high-alert');
        noiseMonitorCard.classList.remove('elevated');
      }
      if (noiseTrendText) noiseTrendText.textContent = '⚠️ Ambient noise exceeds 85 dB • Speak close to mic';
    } else if (isNoiseBlocked && consecutiveHighNoiseFrames === 0) {
      isNoiseBlocked = false;
      if (btnToggleMic) btnToggleMic.classList.remove('noise-blocked');
      if (noiseLockBadge) noiseLockBadge.style.display = 'none';
      if (deckStatusBadge && !isRecording) deckStatusBadge.textContent = 'MIC READY';
      if (recordHint && !isRecording) recordHint.textContent = 'Click microphone to start recording • Speak in Konkani';
      if (noiseAlertBanner) noiseAlertBanner.style.display = 'none';
      if (noiseMonitorCard) noiseMonitorCard.classList.remove('high-alert');
    } else if (estimatedDb >= 65 || meterPercent >= 65) {
      noiseBadge.className = 'noise-badge medium';
      noiseBadge.textContent = 'Normal / Speech';
      if (noiseAlertBanner) noiseAlertBanner.style.display = 'none';
      if (noiseMonitorCard) {
        noiseMonitorCard.classList.remove('high-alert');
        noiseMonitorCard.classList.add('elevated');
      }
      if (noiseTrendText) {
        noiseTrendText.textContent = isRising
          ? 'Voice detected • Ready to record'
          : 'Normal ambient sound • Optimal for Whisper';
      }
    } else {
      noiseBadge.className = 'noise-badge low';
      noiseBadge.textContent = 'Quiet (Optimal)';
      if (noiseAlertBanner) noiseAlertBanner.style.display = 'none';
      if (noiseMonitorCard) {
        noiseMonitorCard.classList.remove('high-alert', 'elevated');
      }
      if (noiseTrendText) noiseTrendText.textContent = 'Environment quiet & optimal for Whisper';
    }
  }

  function monitorAudioStream() {
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
    let average = sum / bufferLength;
    let vuWidth = Math.min(100, Math.max(0, (average / 160) * 100));
    if (vuMeterFill) vuMeterFill.style.width = `${vuWidth}%`;

    updateNoiseMonitor(average);

    animFrameId = requestAnimationFrame(monitorAudioStream);
  }

  // --- RECORDING TIMER ---
  function updateTimer() {
    const mins = Math.floor(recSeconds / 60).toString().padStart(2, '0');
    const secs = (recSeconds % 60).toString().padStart(2, '0');
    const timeStr = `${mins}:${secs}`;
    if (recTimer) recTimer.textContent = timeStr;
    if (vaultLiveTimer) vaultLiveTimer.textContent = timeStr;
  }

  // --- SEND AUDIO CHUNK TO WHISPER BACKEND (via Flask /transcribe) ---
  async function sendAudioChunkToWhisper(blob, sessionId = null) {
    if (!blob || blob.size === 0) return;

    try {
      const formData = new FormData();
      formData.append('audio', blob, 'chunk.webm');

      const res = await fetch(`${BACKEND_URL}/transcribe`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data && data.text && data.text.trim().length > 0) {
        const trimmed = data.text.trim();
        handleReceivedTranscription(trimmed);

        if (sessionId) {
          currentSessionTexts.push(trimmed);
          const existingItem = vaultRecordings.find(r => r.id === sessionId);
          if (existingItem) {
            existingItem.transcription = currentSessionTexts.join(' ').trim();
            saveVaultItemToDB(existingItem);
            renderVaultCards(vaultSearchInput ? vaultSearchInput.value : '');
          }
        }
      }
    } catch (err) {
      console.warn('Transcription request error:', err);
      showToast(`Transcription warning: ${err.message}`, 'error');
    }
  }

    // --- HANDLE INCOMING TRANSCRIPTION TEXT ---
  // Mic chunks (sourceLabel === null) now merge into ONE continuous growing
  // line instead of a new card per chunk. Uploaded files (sourceLabel set)
  // still get their own separate card, since each file is a distinct piece
  // of content, not a live stream.
  function handleReceivedTranscription(konkaniSentence, sourceLabel = null) {
    if (!konkaniSentence || konkaniSentence.trim().length === 0) return;

    totalChunksTranscribed++;
    accumulatedText.push(konkaniSentence);

    if (transcriptPlaceholder) transcriptPlaceholder.style.display = 'none';
    if (transcriptFeed) transcriptFeed.style.display = 'flex';

    if (sourceLabel) {
      // Uploaded file: keep as its own separate card, same as before.
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const entryEl = document.createElement('div');
      entryEl.className = 'transcript-entry';
      entryEl.innerHTML = `
        <div class="entry-meta">
          <span>📁 ${sourceLabel} • ${timestamp}</span>
          <span style="color:var(--emerald-400); font-weight:700;">WHISPER KONKANI</span>
        </div>
        <div class="entry-text">${konkaniSentence}</div>
      `;
      transcriptFeed.appendChild(entryEl);
    } else {
      // Live mic recording: append to one running line instead of a new card.
      let liveEntry = document.getElementById('live-transcript-entry');
      if (!liveEntry) {
        liveEntry = document.createElement('div');
        liveEntry.className = 'transcript-entry';
        liveEntry.id = 'live-transcript-entry';
        liveEntry.innerHTML = `
          <div class="entry-meta">
            <span id="live-transcript-meta">Live Transcript • started</span>
            <span style="color:var(--emerald-400); font-weight:700;">WHISPER KONKANI</span>
          </div>
          <div class="entry-text" id="live-transcript-text"></div>
        `;
        transcriptFeed.appendChild(liveEntry);
      }
      const textEl = document.getElementById('live-transcript-text');
      if (textEl) {
        // Rebuild from only the mic-sourced text collected this session so
        // far, not the whole accumulatedText array (which may also hold
        // file-upload text mixed in from earlier).
        textEl.textContent = currentSessionTexts.length > 0
          ? currentSessionTexts.join(' ').trim()
          : konkaniSentence;
      }
    }

    if (transcriptScrollBox) {
      transcriptScrollBox.scrollTop = transcriptScrollBox.scrollHeight;
    }

    updateWordRibbon(konkaniSentence);
    updateStatistics();
  }

  // --- UPDATE WORD RIBBON WITH TOKENS ---
  function updateWordRibbon(text) {
    if (!ribbonTokensContainer) return;
    const words = text.split(/\s+/).filter(w => w.trim().length > 0);

    let html = '';
    words.forEach(w => {
      html += `<span class="token-chip">[${w}]</span>`;
    });

    ribbonTokensContainer.innerHTML = html;
  }

  // --- UPDATE STATISTICS ---
  function updateStatistics() {
    const fullText = accumulatedText.join(' ').trim();
    const words = fullText.length > 0 ? fullText.split(/\s+/).filter(w => w.length > 0).length : 0;
    const chars = fullText.length;

    if (statWords) statWords.textContent = words;
    if (statChars) statChars.textContent = chars;
    if (statChunks) statChunks.textContent = totalChunksTranscribed;
  }

  // --- SLICE MANAGEMENT: start/stop individual MediaRecorder segments ---
  // A "slice" is one continuous MediaRecorder recording that becomes one
  // chunk sent to /transcribe. startNextSlice() begins a new slice;
  // cutCurrentSlice() ends the current one (triggered by silence detection
  // or the max-duration safety cap) and immediately starts the next one so
  // no audio is lost between sentences.
  function startNextSlice() {
    if (!isRecording || !micStream) return;

    try {
      mediaRecorder = new MediaRecorder(micStream);
    } catch (e) {
      console.error('Failed to create slice recorder:', e);
      return;
    }

    let sliceParts = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        sliceParts.push(e.data);
        currentSessionChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      if (sliceParts.length > 0) {
        const chunkBlob = new Blob(sliceParts, { type: 'audio/webm' });
        if (chunkBlob.size > 800) {
          sendAudioChunkToWhisper(chunkBlob, currentSessionId);
        }
      }
    };

    mediaRecorder.start();
    currentSliceStartTime = Date.now();
    silenceStartTime = null;
  }

  function cutCurrentSlice() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      startNextSlice();
    }
  }

  // --- RECORDING CONTROLS ---
  async function startRecording() {
    if (isNoiseBlocked) {
      showToast('ℹ️ Notice: High ambient noise (>85 dB). Speaking close to mic is recommended.', 'info');
      isNoiseBlocked = false;
    }

    try {
      if (!micStream) {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (err) {
      showToast('Microphone access denied or unavailable in browser.', 'error');
      console.error(err);
      return;
    }

    initAudioAnalysis(micStream);
    if (!animFrameId) {
      monitorAudioStream();
    }

    currentSessionNum = (vaultRecordings.filter(r => r.type === 'mic').length || 0) + 1;
    currentSessionId = 'rec_' + Date.now();
    currentSessionChunks = [];
    currentSessionTexts = [];
    audioChunksQueue = [];

    if (vaultLiveBanner) vaultLiveBanner.style.display = 'block';
    if (vaultLiveSessionNum) vaultLiveSessionNum.textContent = `#${currentSessionNum}`;
    if (vaultLiveTimer) vaultLiveTimer.textContent = '00:00';

    isRecording = true;

    startNextSlice();

    btnToggleMic.classList.add('recording');
    if (micBtnWrapper) micBtnWrapper.classList.add('active');
    if (liveRecDot) liveRecDot.classList.add('active');
    if (deckStatusBadge) deckStatusBadge.textContent = 'RECORDING LIVE';
    if (recordHint) recordHint.textContent = 'Listening continuously... Speak in Konkani!';

    recSeconds = 0;
    updateTimer();
    clearInterval(recTimerInterval);
    recTimerInterval = setInterval(() => {
      recSeconds++;
      updateTimer();
    }, 1000);

    showToast('🎙️ Live Recording Started • Speaking Konkani', 'info');
  }

  function finalizeMicSession() {
    if (currentSessionChunks.length === 0) return;

    const fullBlob = new Blob(currentSessionChunks, { type: 'audio/webm' });
    if (fullBlob.size === 0) return;

    const sessionRecord = {
      id: currentSessionId,
      type: 'mic',
      title: `Voice Session #${currentSessionNum}`,
      timestamp: new Date().toISOString(),
      displayDate: new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }),
      displayTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      durationSeconds: recSeconds,
      audioBlob: fullBlob,
      audioUrl: URL.createObjectURL(fullBlob),
      transcription: currentSessionTexts.join(' ').trim(),
      sizeBytes: fullBlob.size
    };

    addRecordToVault(sessionRecord);
    showToast('✓ Spoken recording saved to Vault! Ready to listen & download', 'success');
  }

  function stopRecording() {
    isRecording = false;

    if (vaultLiveBanner) vaultLiveBanner.style.display = 'none';
    if (btnToggleMic) btnToggleMic.classList.remove('recording', 'noise-blocked');
    if (micBtnWrapper) micBtnWrapper.classList.remove('active');
    if (liveRecDot) liveRecDot.classList.remove('active');

    if (deckStatusBadge) deckStatusBadge.textContent = 'MIC PAUSED';
    if (recordHint) recordHint.textContent = 'Recording stopped • Click microphone to record again';

    clearInterval(recTimerInterval);
    silenceStartTime = null;
    currentSliceStartTime = null;

    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try { mediaRecorder.stop(); } catch (e) {}
    }

    setTimeout(() => {
      finalizeMicSession();
    }, 250);

    showToast('⏹️ Recording Stopped', 'info');
  }

  if (btnToggleMic) {
    btnToggleMic.addEventListener('click', () => {
      if (!isRecording) {
        startRecording();
      } else {
        stopRecording();
      }
    });
  }

  // --- ACTION TOOLBAR LISTENERS ---

  if (btnCopyText) {
    btnCopyText.addEventListener('click', async () => {
      const fullText = accumulatedText.join('\n\n').trim();
      if (!fullText) {
        showToast('No transcribed text to copy yet.', 'warning');
        return;
      }
      try {
        await navigator.clipboard.writeText(fullText);
        showToast('✓ Konkani text copied to clipboard!', 'success');
      } catch (e) {
        showToast('Could not copy to clipboard.', 'error');
      }
    });
  }

  if (btnDownloadTxt) {
    btnDownloadTxt.addEventListener('click', () => {
      const fullText = accumulatedText.join('\n\n').trim();
      if (!fullText) {
        showToast('No transcribed text to save yet.', 'warning');
        return;
      }
      const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `konkani_transcript_${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('✓ Transcript downloaded as .txt', 'success');
    });
  }

  if (btnClearTranscript) {
    btnClearTranscript.addEventListener('click', () => {
      if (accumulatedText.length === 0) return;
      if (confirm('Clear all transcribed text?')) {
        accumulatedText = [];
        totalChunksTranscribed = 0;
        if (transcriptFeed) {
          transcriptFeed.innerHTML = '';
          transcriptFeed.style.display = 'none';
        }
        if (transcriptPlaceholder) transcriptPlaceholder.style.display = 'flex';
        if (ribbonTokensContainer) {
          ribbonTokensContainer.innerHTML = '<span class="token-chip placeholder">Tokens will appear here as you speak...</span>';
        }
        updateStatistics();
        showToast('🗑️ Transcript cleared', 'info');
      }
    });
  }

  // --- AUDIO FILE UPLOAD & TRANSCRIPTION ---
  let selectedAudioFile = null;
  let isTranscribingFile = false;

  function handleFileSelected(file) {
    if (!file) return;

    selectedAudioFile = file;
    const sizeKb = (file.size / 1024).toFixed(1);
    if (previewFileName) previewFileName.textContent = `${file.name} (${sizeKb} KB)`;

    if (previewAudioPlayer) {
      previewAudioPlayer.src = URL.createObjectURL(file);
    }

    if (dropZoneTrigger) dropZoneTrigger.style.display = 'none';
    if (uploadedFilePreview) uploadedFilePreview.style.display = 'flex';

    showToast(`✓ Loaded ${file.name}. Ready to transcribe!`, 'info');
  }

  function resetFileUpload() {
    selectedAudioFile = null;
    isTranscribingFile = false;
    if (audioFileInput) audioFileInput.value = '';
    if (previewAudioPlayer) {
      previewAudioPlayer.pause();
      previewAudioPlayer.src = '';
    }
    if (uploadedFilePreview) uploadedFilePreview.style.display = 'none';
    if (dropZoneTrigger) dropZoneTrigger.style.display = 'flex';
    if (btnTranscribeFile) btnTranscribeFile.disabled = false;
    if (transcribeBtnLabel) transcribeBtnLabel.textContent = 'Transcribe Uploaded File';
  }

  if (dropZoneTrigger && audioFileInput) {
    dropZoneTrigger.addEventListener('click', () => audioFileInput.click());
  }

  if (audioFileInput) {
    audioFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleFileSelected(e.target.files[0]);
      }
    });
  }

  if (fileDropZone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      fileDropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileDropZone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      fileDropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileDropZone.classList.remove('dragover');
      });
    });

    fileDropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files[0]) {
        handleFileSelected(dt.files[0]);
      }
    });
  }

  if (btnRemoveFile) {
    btnRemoveFile.addEventListener('click', resetFileUpload);
  }

  // Transcribe Uploaded File (via Flask /transcribe)
  if (btnTranscribeFile) {
    btnTranscribeFile.addEventListener('click', async () => {
      if (!selectedAudioFile || isTranscribingFile) return;

      isTranscribingFile = true;
      btnTranscribeFile.disabled = true;
      if (transcribeBtnLabel) transcribeBtnLabel.textContent = 'Transcribing with Whisper...';
      showToast(`⏳ Transcribing ${selectedAudioFile.name}...`, 'info');

      try {
        const formData = new FormData();
        formData.append('audio', selectedAudioFile, selectedAudioFile.name);

        const res = await fetch(`${BACKEND_URL}/transcribe`, {
          method: 'POST',
          body: formData
        });
        const data = await res.json();

        if (data && data.text && data.text.trim().length > 0) {
          const transcribedText = data.text.trim();
          handleReceivedTranscription(transcribedText, selectedAudioFile.name);
          showToast(`✓ Successfully transcribed ${selectedAudioFile.name}!`, 'success');

          const fileRecord = {
            id: 'file_' + Date.now(),
            type: 'file',
            title: selectedAudioFile.name,
            timestamp: new Date().toISOString(),
            displayDate: new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }),
            displayTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            durationSeconds: Math.round((previewAudioPlayer && previewAudioPlayer.duration) ? previewAudioPlayer.duration : 0),
            audioBlob: selectedAudioFile,
            audioUrl: URL.createObjectURL(selectedAudioFile),
            transcription: transcribedText,
            sizeBytes: selectedAudioFile.size
          };
          addRecordToVault(fileRecord);
        } else {
          showToast('Transcription returned empty or silence.', 'warning');
        }
      } catch (err) {
        console.error('File transcription error:', err);
        showToast(`Transcription error: ${err.message}`, 'error');
      } finally {
        isTranscribingFile = false;
        if (btnTranscribeFile) btnTranscribeFile.disabled = false;
        if (transcribeBtnLabel) transcribeBtnLabel.textContent = 'Transcribe Uploaded File';
      }
    });
  }

  // ==========================================================================
  // SPOKEN AUDIO & TRANSCRIPTION VAULT CONTROLLER (INDEXEDDB + DOWNLOADS)
  // ==========================================================================

  const DB_NAME = 'KonkaniVoiceVaultDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'recordings';

  function openDB() {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => {
          console.warn('IndexedDB open error:', e);
          resolve(null);
        };
      } catch (e) {
        console.warn('IndexedDB access blocked or unsupported:', e);
        resolve(null);
      }
    });
  }

  async function loadVaultFromDB() {
    try {
      const db = await openDB();
      if (!db) return [];
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const records = req.result || [];
          records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          records.forEach(r => {
            if (r.audioBlob && !r.audioUrl) {
              r.audioUrl = URL.createObjectURL(r.audioBlob);
            }
          });
          resolve(records);
        };
        req.onerror = () => resolve([]);
      });
    } catch (e) {
      console.warn('loadVaultFromDB error:', e);
      return [];
    }
  }

  async function saveVaultItemToDB(item) {
    try {
      const db = await openDB();
      if (!db) return;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const toStore = { ...item };
      delete toStore.audioUrl;
      store.put(toStore);
    } catch (e) {
      console.warn('saveVaultItemToDB error:', e);
    }
  }

  async function deleteVaultItemFromDB(id) {
    try {
      const db = await openDB();
      if (!db) return;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);
    } catch (e) {
      console.warn('deleteVaultItemFromDB error:', e);
    }
  }

  async function clearVaultFromDB() {
    try {
      const db = await openDB();
      if (!db) return;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
    } catch (e) {
      console.warn('clearVaultFromDB error:', e);
    }
  }

  function formatDuration(sec) {
    if (!sec || isNaN(sec) || sec <= 0) return '00:00';
    const mins = Math.floor(sec / 60).toString().padStart(2, '0');
    const secs = (sec % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 KB';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[m]);
  }

  function addRecordToVault(record) {
    vaultRecordings.unshift(record);
    saveVaultItemToDB(record);
    renderVaultCards(vaultSearchInput ? vaultSearchInput.value : '');
  }

  function renderVaultCards(filterQuery = '') {
    const query = filterQuery.toLowerCase().trim();
    const filtered = vaultRecordings.filter(rec => {
      if (!query) return true;
      const titleMatch = (rec.title || '').toLowerCase().includes(query);
      const textMatch = (rec.transcription || '').toLowerCase().includes(query);
      const dateMatch = (rec.displayDate || '').toLowerCase().includes(query);
      return titleMatch || textMatch || dateMatch;
    });

    if (vaultCountBadge) {
      vaultCountBadge.textContent = `${vaultRecordings.length} ${vaultRecordings.length === 1 ? 'RECORDING' : 'RECORDINGS'}`;
    }
    if (headerVaultBadge) {
      headerVaultBadge.textContent = vaultRecordings.length;
    }

    if (vaultStatTotal) vaultStatTotal.textContent = vaultRecordings.length;

    const totalSeconds = vaultRecordings.reduce((sum, r) => sum + (r.durationSeconds || 0), 0);
    if (vaultStatDuration) vaultStatDuration.textContent = formatDuration(totalSeconds);

    const totalWords = vaultRecordings.reduce((sum, r) => {
      const txt = (r.transcription || '').trim();
      return sum + (txt ? txt.split(/\s+/).filter(w => w.length > 0).length : 0);
    }, 0);
    if (vaultStatWords) vaultStatWords.textContent = totalWords;

    if (!vaultCardsGrid || !vaultEmptyState) return;

    if (filtered.length === 0) {
      vaultEmptyState.style.display = 'flex';
      vaultCardsGrid.style.display = 'none';
      vaultCardsGrid.innerHTML = '';

      if (query) {
        vaultEmptyState.querySelector('.empty-title').textContent = 'No matching recordings found';
        vaultEmptyState.querySelector('.empty-description').textContent = `No spoken recordings matched "${filterQuery}". Try a different keyword or clear the search filter.`;
      } else {
        vaultEmptyState.querySelector('.empty-title').textContent = 'No Spoken Recordings Yet';
        vaultEmptyState.querySelector('.empty-description').textContent = 'Start speaking using the Voice Recording Deck above or upload an audio file. Every spoken session will be automatically saved here so you can listen back to your voice, read what you spoke in Konkani, and download your audio files (.webm) and transcripts (.txt)!';
      }
      return;
    }

    vaultEmptyState.style.display = 'none';
    vaultCardsGrid.style.display = 'grid';

    let cardsHtml = '';
    filtered.forEach(rec => {
      const isMic = rec.type === 'mic';
      const iconName = isMic ? 'mic' : 'file-audio';
      const typeLabel = isMic ? 'Microphone Recording' : 'Uploaded File';
      const wordsCount = rec.transcription ? rec.transcription.trim().split(/\s+/).filter(w => w.length > 0).length : 0;
      const charsCount = rec.transcription ? rec.transcription.trim().length : 0;
      const hasSpeech = rec.transcription && rec.transcription.trim().length > 0;

      cardsHtml += `
        <article class="vault-item-card" data-card-id="${rec.id}">
          <div class="vault-item-header">
            <div class="vault-item-title-col">
              <div class="vault-item-title">
                <i data-lucide="${iconName}" style="width:16px; color:${isMic ? 'var(--neon-green)' : 'var(--emerald-400)'};"></i>
                <span>${escapeHtml(rec.title)}</span>
              </div>
              <div class="vault-item-timestamp">
                <span>${escapeHtml(rec.displayDate)} • ${escapeHtml(rec.displayTime)}</span>
              </div>
            </div>

            <div class="vault-item-pills">
              <span class="vault-pill duration" title="Recording Duration">
                <i data-lucide="clock" style="width:11px;"></i> ${formatDuration(rec.durationSeconds)}
              </span>
              <span class="vault-pill" title="Audio Size">
                <i data-lucide="hard-drive" style="width:11px;"></i> ${formatBytes(rec.sizeBytes)}
              </span>
            </div>
          </div>

          <div class="vault-audio-box">
            <audio controls preload="metadata" class="vault-audio-player" src="${rec.audioUrl}"></audio>
          </div>

          <div class="vault-speech-content">
            <div class="vault-speech-label">
              <span><i data-lucide="sparkles" style="width:12px; margin-right:4px;"></i> कोंकणी उलयिल्लें (Transcribed Speech)</span>
              <span style="opacity:0.75; font-family:var(--font-mono); font-size:0.65rem;">WHISPER KONKANI</span>
            </div>
            <div class="vault-speech-text ${hasSpeech ? '' : 'empty'}">
              ${hasSpeech ? escapeHtml(rec.transcription) : '(Waiting for transcription or no spoken words detected)'}
            </div>
            <div class="vault-speech-meta">
              <span><strong>${wordsCount}</strong> Words</span>
              <span><strong>${charsCount}</strong> Characters</span>
              <span>${typeLabel}</span>
            </div>
          </div>

          <div class="vault-item-actions">
            <button class="btn-vault-action audio-dl" data-action="download-audio" data-id="${rec.id}" title="Download your voice recording (.webm)">
              <i data-lucide="download" style="width:13px;"></i>
              <span>Download Audio</span>
            </button>
            <button class="btn-vault-action text-dl" data-action="download-transcript" data-id="${rec.id}" title="Download Konkani transcript (.txt)">
              <i data-lucide="file-text" style="width:13px;"></i>
              <span>Download Text</span>
            </button>
            <button class="btn-vault-action copy-btn" data-action="copy-text" data-id="${rec.id}" title="Copy Konkani text">
              <i data-lucide="copy" style="width:13px;"></i>
              <span>Copy</span>
            </button>
            <button class="btn-vault-action delete-btn" data-action="delete" data-id="${rec.id}" title="Delete this recording">
              <i data-lucide="trash-2" style="width:14px;"></i>
            </button>
          </div>
        </article>
      `;
    });

    vaultCardsGrid.innerHTML = cardsHtml;

    if (window.lucide) {
      lucide.createIcons();
    }
  }

  function downloadVaultAudio(id) {
    const rec = vaultRecordings.find(r => r.id === id);
    if (!rec) return;

    const url = rec.audioUrl || (rec.audioBlob ? URL.createObjectURL(rec.audioBlob) : null);
    if (!url) {
      showToast('Audio file unavailable for download.', 'error');
      return;
    }

    const cleanTitle = (rec.title || 'recording').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const filename = `konkani_${cleanTitle}_${Date.now()}.webm`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    showToast(`✓ Downloaded spoken audio: ${filename}`, 'success');
  }

  function downloadVaultTranscript(id) {
    const rec = vaultRecordings.find(r => r.id === id);
    if (!rec) return;

    const textContent = `=====================================================
KONKANI VOICE AI STUDIO - RECORDING TRANSCRIPT
=====================================================
Session Title   : ${rec.title}
Date & Time     : ${rec.displayDate} at ${rec.displayTime}
Audio Duration  : ${formatDuration(rec.durationSeconds)}
Source Type     : ${rec.type === 'mic' ? 'Microphone Voice Input' : 'Uploaded Audio File'}
File Size       : ${formatBytes(rec.sizeBytes)}
=====================================================
TRANSCRIPTION (कोंकणी - Devanagari):
=====================================================
${rec.transcription ? rec.transcription : '(No Konkani text was transcribed for this session)'}
=====================================================
Generated by Konkani Voice AI Studio (Fine-Tuned Whisper Small LoRA)
`;

    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const cleanTitle = (rec.title || 'transcript').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const filename = `konkani_${cleanTitle}_transcript.txt`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`✓ Downloaded Konkani transcript (.txt)`, 'success');
  }

  function exportAllTranscripts() {
    if (vaultRecordings.length === 0) {
      showToast('No recordings in vault to export.', 'warning');
      return;
    }

    let fullExport = `======================================================================
KONKANI VOICE AI STUDIO - MASTER TRANSCRIPT EXPORT
Total Recordings: ${vaultRecordings.length}
Exported On     : ${new Date().toLocaleString()}
======================================================================\n\n`;

    vaultRecordings.forEach((rec, idx) => {
      fullExport += `----------------------------------------------------------------------
#${idx + 1} | ${rec.title}
Date & Time: ${rec.displayDate} ${rec.displayTime} | Duration: ${formatDuration(rec.durationSeconds)} | Type: ${rec.type === 'mic' ? 'Mic' : 'File'}
----------------------------------------------------------------------
${rec.transcription ? rec.transcription : '(No Konkani text)'}\n\n`;
    });

    fullExport += `======================================================================
End of Konkani Voice AI Studio Export
======================================================================`;

    const blob = new Blob([fullExport], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `konkani_all_transcripts_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`✓ Exported all ${vaultRecordings.length} transcripts to .txt`, 'success');
  }

  async function copyVaultText(id) {
    const rec = vaultRecordings.find(r => r.id === id);
    if (!rec || !rec.transcription) {
      showToast('No transcribed text to copy for this recording.', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(rec.transcription);
      showToast('✓ Konkani text copied to clipboard!', 'success');
    } catch (e) {
      showToast('Could not copy text to clipboard.', 'error');
    }
  }

  async function deleteVaultItem(id) {
    const index = vaultRecordings.findIndex(r => r.id === id);
    if (index === -1) return;

    const item = vaultRecordings[index];
    if (item.audioUrl) {
      try { URL.revokeObjectURL(item.audioUrl); } catch (e) {}
    }

    vaultRecordings.splice(index, 1);
    await deleteVaultItemFromDB(id);
    renderVaultCards(vaultSearchInput ? vaultSearchInput.value : '');
    showToast('🗑️ Recording removed from vault.', 'info');
  }

  async function clearEntireVault() {
    if (vaultRecordings.length === 0) return;
    if (!confirm('Are you sure you want to clear all spoken recordings from your vault? This cannot be undone.')) {
      return;
    }

    vaultRecordings.forEach(r => {
      if (r.audioUrl) {
        try { URL.revokeObjectURL(r.audioUrl); } catch (e) {}
      }
    });

    vaultRecordings = [];
    await clearVaultFromDB();
    renderVaultCards();
    showToast('🗑️ Voice Vault cleared.', 'info');
  }

  if (vaultCardsGrid) {
    vaultCardsGrid.addEventListener('click', (e) => {
      const button = e.target.closest('[data-action]');
      if (!button) return;

      const action = button.getAttribute('data-action');
      const id = button.getAttribute('data-id');

      if (action === 'download-audio') {
        downloadVaultAudio(id);
      } else if (action === 'download-transcript') {
        downloadVaultTranscript(id);
      } else if (action === 'copy-text') {
        copyVaultText(id);
      } else if (action === 'delete') {
        deleteVaultItem(id);
      }
    });
  }

  if (vaultSearchInput) {
    vaultSearchInput.addEventListener('input', (e) => {
      const val = e.target.value;
      if (vaultSearchClear) {
        vaultSearchClear.style.display = val ? 'block' : 'none';
      }
      renderVaultCards(val);
    });
  }

  if (vaultSearchClear) {
    vaultSearchClear.addEventListener('click', () => {
      if (vaultSearchInput) vaultSearchInput.value = '';
      vaultSearchClear.style.display = 'none';
      renderVaultCards('');
    });
  }

  if (btnExportAllTranscripts) {
    btnExportAllTranscripts.addEventListener('click', exportAllTranscripts);
  }

  if (btnClearVault) {
    btnClearVault.addEventListener('click', clearEntireVault);
  }

  function openVaultModal() {
    if (!vaultModalBackdrop) return;
    vaultModalBackdrop.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    renderVaultCards(vaultSearchInput ? vaultSearchInput.value : '');
    if (window.lucide) {
      lucide.createIcons();
    }
    if (vaultSearchInput) {
      setTimeout(() => vaultSearchInput.focus(), 150);
    }
  }

  function closeVaultModal() {
    if (!vaultModalBackdrop) return;
    vaultModalBackdrop.style.display = 'none';
    document.body.style.overflow = '';
  }

  if (btnOpenVault) {
    btnOpenVault.addEventListener('click', openVaultModal);
  }

  if (btnCloseVault) {
    btnCloseVault.addEventListener('click', closeVaultModal);
  }

  if (vaultModalBackdrop) {
    vaultModalBackdrop.addEventListener('click', (e) => {
      if (e.target === vaultModalBackdrop) {
        closeVaultModal();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && vaultModalBackdrop && vaultModalBackdrop.style.display === 'flex') {
      closeVaultModal();
    }
  });

  // Warm up ambient background noise monitoring on first user interaction
  async function initAmbientMic() {
    if (micStream) return;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      initAudioAnalysis(micStream);
      if (!animFrameId) {
        monitorAudioStream();
      }
    } catch (e) {
      // Will be prompted when user clicks record
    }
  }

  document.addEventListener('click', function onUserClick() {
    if (!micStream) {
      initAmbientMic();
    }
    document.removeEventListener('click', onUserClick);
  }, { once: true });

  // Initialize Vault from IndexedDB on page startup
  loadVaultFromDB().then((saved) => {
    vaultRecordings = saved || [];
    renderVaultCards();
  });
});