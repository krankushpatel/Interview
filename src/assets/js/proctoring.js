/**
 * AI Interview Platform — Proctoring System v3
 * With face-api.js support (SSD Mobilenet) + pixel variance fallback
 * Enhanced: Better multiple face detection with visual feedback
 */
'use strict';

class ProctoringSystem {
  constructor(opts = {}) {
    this.events = [];
    this.warningCount = 0;
    this.maxWarnings = opts.maxWarnings || 5;
    this.startTime = Date.now();
    this.active = false;
    this._handlers = {};

    this._cb = {
      onWarning: opts.onWarning || (() => { }),
      onTerminate: opts.onTerminate || (() => { }),
      onEvent: opts.onEvent || (() => { }),
      onFaceAlert: opts.onFaceAlert || (() => { }),
    };

    // Face-detection state
    this._faceCanvas = null;
    this._faceCtx = null;
    this._faceTimer = null;
    this._videoEl = null;
    this._faceReady = false;
    this._faceModelsLoaded = false;
    this._noFaceCount = 0;
    this._multiFaceCount = 0;  // Track consecutive multiple face detections
    this._lastFaceCount = 0;   // Track last detected face count

    // Threshold = 1 → warn on the very first detection (no delay)
    this._consecutiveThreshold = 1;

    // Cooldown: don't fire the same warning type more often than this (ms)
    this._warnCooldown = 8000;  // 8 s between repeat modal-warnings
    this._lastMultiWarnAt = 0;
    this._lastNoFaceWarnAt = 0;
    this._lastMultiAlertAt = 0;    // ← separate cooldown for toast/badge alerts (4 s)
    this._lastNoFaceAlertAt = 0;   // ← separate cooldown for toast/badge alerts (4 s)

    // No-face sustained absence → exam termination
    // If no face stays absent for this many seconds, the exam is flagged/terminated
    this._noFaceTriggerDelay = opts.noFaceTriggerDelay || 10; // seconds
    this._noFaceAbsenceTimer = null;   // setTimeout handle
    this._noFaceCountdownTimer = null;  // setInterval for per-second countdown
    this._noFaceSecondsLeft = 0;     // countdown value exposed via callback

    // Optional per-second countdown callback: fn(secondsLeft)
    this._cb.onNoFaceCountdown = opts.onNoFaceCountdown || (() => { });
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.startTime = Date.now();
    this._attach();
    console.log('[Proctor] Started');
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this._detach();
    this._stopFaceDetection();
    console.log('[Proctor] Stopped');
  }

  getEvents() { return [...this.events]; }
  getWarningCount() { return this.warningCount; }

  getSummary() {
    const typeCounts = {};
    for (const e of this.events) typeCounts[e.event] = (typeCounts[e.event] || 0) + 1;
    return {
      total_events: this.events.length,
      warning_count: this.warningCount,
      event_types: typeCounts,
      events: this.events,
    };
  }

  requestFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
    if (req) req.call(el).catch(() => { });
  }

  isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
  }

  async loadFaceModels() {
    // Try project root first — manifest JSONs ship in the same folder as index/dashboard.html
    // Then '/models' (if download_models.sh was run), then CDN fallbacks
    const MODEL_URLS = [
      '',                  // ← project root (same dir as dashboard.html) ✅ primary
      '.',                 // ← alternate root form
      '/models',           // ← local /models folder (after download_models.sh)
      'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights',
      'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights',
      'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/0.22.2/weights',
    ];

    for (const url of MODEL_URLS) {
      try {
        await faceapi.nets.tinyFaceDetector.loadFromUri(url);
        this._faceModelsLoaded = true;
        this._faceModelUrl = url;
        console.log(`[Proctor] ✓ TinyFaceDetector loaded from: "${url || '(root)'}"`);
        return true;
      } catch (err) {
        console.warn(`[Proctor] ✗ Model load failed at "${url || '(root)'}":`, err.message || err.name || err);
      }
    }

    console.error('[Proctor] All model sources failed — pixel-variance fallback active');
    this._faceModelsLoaded = false;
    return false;
  }

  async startFaceDetection(videoEl) {
    if (!videoEl) {
      console.error('[Proctor] No video element provided');
      return;
    }
    this._videoEl = videoEl;
    this._faceReady = true;
    this._noFaceCount = 0;
    this._multiFaceCount = 0;
    this._faceDetecting = false;   // guard: prevents concurrent inference calls

    // Show "loading model" in the face-count UI while we wait
    const faceEl = document.getElementById('face-count');
    if (faceEl) faceEl.textContent = '…';

    // Wait until the video stream is actually playing before kicking off detection
    await this._waitForVideoReady(videoEl);

    console.log('[Proctor] Starting face detection, video readyState:', videoEl.readyState);

    const loaded = await this.loadFaceModels();
    if (!loaded) {
      // Pixel variance fallback — only presence/absence, not multi-face
      this._faceCanvas = document.createElement('canvas');
      this._faceCanvas.width = 160;
      this._faceCanvas.height = 120;
      this._faceCtx = this._faceCanvas.getContext('2d');
      this._faceTimer = setInterval(() => this._checkFaceFallback(), 2000);
      if (faceEl) faceEl.textContent = '?';
      console.log('[Proctor] Using pixel variance fallback (multi-face detection unavailable)');
    } else {
      // face-api TinyFaceDetector — check every 1000 ms
      this._faceTimer = setInterval(() => this._checkFaces(), 1000);
      if (faceEl) faceEl.textContent = '0';
      console.log('[Proctor] TinyFaceDetector active — polling every 1000ms');
    }
  }

  // Resolves once video has enough data to run inference on
  _waitForVideoReady(videoEl) {
    return new Promise(resolve => {
      if (videoEl.readyState >= 2) { resolve(); return; }
      const onReady = () => { videoEl.removeEventListener('loadeddata', onReady); resolve(); };
      videoEl.addEventListener('loadeddata', onReady);
      // Safety timeout — don't wait forever
      setTimeout(resolve, 5000);
    });
  }

  _stopFaceDetection() {
    clearInterval(this._faceTimer);
    this._clearNoFaceAbsenceTimer();
    this._faceReady = false;
  }

  // ── No-face sustained absence helpers ────────────────────────────────────
  _startNoFaceAbsenceTimer() {
    if (this._noFaceAbsenceTimer) return; // already running

    this._noFaceSecondsLeft = this._noFaceTriggerDelay;
    this._cb.onNoFaceCountdown(this._noFaceSecondsLeft);

    // Per-second countdown tick
    this._noFaceCountdownTimer = setInterval(() => {
      this._noFaceSecondsLeft = Math.max(0, this._noFaceSecondsLeft - 1);
      this._cb.onNoFaceCountdown(this._noFaceSecondsLeft);
    }, 1000);

    // Terminal timer
    this._noFaceAbsenceTimer = setTimeout(() => {
      clearInterval(this._noFaceCountdownTimer);
      this._noFaceCountdownTimer = null;
      this._noFaceAbsenceTimer = null;
      this.logEvent('no_face_prolonged_termination');
      try {
        this._cb.onTerminate({
          reason: 'Candidate absent from camera for too long',
          type: 'no_face_prolonged',
          events: this.events,
        });
      } catch (e) {
        console.error('[Proctor] onTerminate callback error:', e);
      }
    }, this._noFaceTriggerDelay * 1000);
  }

  _clearNoFaceAbsenceTimer() {
    if (this._noFaceAbsenceTimer) {
      clearTimeout(this._noFaceAbsenceTimer);
      this._noFaceAbsenceTimer = null;
    }
    if (this._noFaceCountdownTimer) {
      clearInterval(this._noFaceCountdownTimer);
      this._noFaceCountdownTimer = null;
    }
    this._noFaceSecondsLeft = 0;
    // Notify UI that countdown is gone (pass -1 as sentinel)
    try { this._cb.onNoFaceCountdown(-1); } catch (_) { }
  }

  // Pixel variance fallback (detects presence/absence only)
  _checkFaceFallback() {
    if (!this._faceReady || !this._videoEl || this._videoEl.readyState < 2) return;
    if (!this._faceCtx) return;

    try {
      this._faceCtx.drawImage(this._videoEl, 0, 0, 160, 120);
      const d = this._faceCtx.getImageData(20, 10, 120, 100).data; // wider sample area
      let mean = 0;
      for (let i = 0; i < d.length; i += 4) mean += (d[i] + d[i + 1] + d[i + 2]) / 3;
      mean /= (d.length / 4);
      let variance = 0;
      for (let i = 0; i < d.length; i += 4) {
        const v = (d[i] + d[i + 1] + d[i + 2]) / 3 - mean;
        variance += v * v;
      }
      variance /= (d.length / 4);

      console.log(`[Proctor-fallback] frame variance: ${variance.toFixed(1)}`);

      // variance < 300 in a live feed usually means a blank/covered camera
      if (variance < 300) {
        this._noFaceCount++;
        const faceEl = document.getElementById('face-count');
        if (faceEl) faceEl.textContent = '0';

        if (this._noFaceCount >= 1) {
          try { this._cb.onFaceAlert('No face detected in frame'); } catch (_) { }
          this._startNoFaceAbsenceTimer();

          if (Date.now() - this._lastNoFaceWarnAt >= this._warnCooldown) {
            this._lastNoFaceWarnAt = Date.now();
            this.logEvent('no_face_detected');
            this.warn('no_face_detected', 'Face missing (fallback sensor)');
          }
        }
      } else {
        // Face (or something) visible — reset
        if (this._noFaceCount > 0) {
          this._noFaceCount = 0;
          this._clearNoFaceAbsenceTimer();
          try { this._cb.onFaceAlert('✅ Face visible'); } catch (_) { }
          const faceEl = document.getElementById('face-count');
          if (faceEl) faceEl.textContent = '1';
        }
      }
    } catch (_) { }
  }

  // face-api TinyFaceDetector — works for 0, 1, or N faces
  async _checkFaces() {
    // Guard: skip if a detection is already in progress (prevents queue build-up)
    if (this._faceDetecting) return;
    if (!this._faceReady || !this._videoEl || this._videoEl.readyState < 2) return;

    this._faceDetecting = true;
    try {
      const detections = await faceapi.detectAllFaces(
        this._videoEl,
        new faceapi.TinyFaceDetectorOptions({
          inputSize: 224,   // 160|224|320 — faster + still accurate
          scoreThreshold: 0.3,   // ← lowered from 0.45 for better sensitivity
        })
      );

      const faceCount = detections.length;
      const now = Date.now();

      // ── Update live face counter in the UI ────────────────────────────────
      const faceEl = document.getElementById('face-count');
      if (faceEl) faceEl.textContent = faceCount;

      // Also update the face status indicator if present
      const faceStatus = document.getElementById('face-status-dot');
      if (faceStatus) {
        faceStatus.style.background = faceCount === 1 ? 'var(--green)' : faceCount === 0 ? 'var(--red)' : 'var(--yellow)';
      }

      console.log(`[Proctor] Detected ${faceCount} face(s)`);

      // ── Multiple faces ────────────────────────────────────────────────────
      if (faceCount > 1) {
        this._multiFaceCount++;
        this._noFaceCount = 0;
        this._clearNoFaceAbsenceTimer();

        if (this._multiFaceCount >= this._consecutiveThreshold) {
          const message = `MULTIPLE faces: ${faceCount} people detected`;
          console.warn('[Proctor] ⚠', message);

          // Alert callback with per-alert cooldown (avoid toast spam every 1s)
          if (now - this._lastMultiAlertAt >= 4000) {
            this._lastMultiAlertAt = now;
            try { this._cb.onFaceAlert(message); } catch (e) { }
          }

          // Warning (modal + log) with longer cooldown
          if (now - this._lastMultiWarnAt >= this._warnCooldown) {
            this._lastMultiWarnAt = now;
            this.logEvent('multiple_faces_detected');
            this.warn('multiple_faces_detected', `Detected ${faceCount} faces in the video frame`);
          }

          this._multiFaceCount = 0;
        }

        // ── No face ──────────────────────────────────────────────────────────
      } else if (faceCount === 0) {
        this._noFaceCount++;
        this._multiFaceCount = 0;

        // React on FIRST consecutive no-face detection (was: >= 2)
        if (this._noFaceCount >= 1) {
          console.warn('[Proctor] 😶 No face detected');

          // Alert callback with cooldown
          if (now - this._lastNoFaceAlertAt >= 4000) {
            this._lastNoFaceAlertAt = now;
            try { this._cb.onFaceAlert('No face detected'); } catch (e) { }
          }

          // Warning (modal + log) with longer cooldown
          if (now - this._lastNoFaceWarnAt >= this._warnCooldown) {
            this._lastNoFaceWarnAt = now;
            this.logEvent('no_face_detected');
            this.warn('no_face_detected', 'Face missing from camera');
          }

          // Start the absence countdown (flags/terminates exam if sustained)
          this._startNoFaceAbsenceTimer();
        }

        // ── Exactly 1 face — all good ─────────────────────────────────────────
      } else {
        if (this._noFaceCount > 0 || this._multiFaceCount > 0) {
          this.logEvent('face_returned');
          try { this._cb.onFaceAlert('✅ Face detected OK'); } catch (e) { }
          this._clearNoFaceAbsenceTimer();
        }
        this._noFaceCount = 0;
        this._multiFaceCount = 0;
        this._lastNoFaceAlertAt = 0; // allow immediate alert on next no-face
        this._lastMultiAlertAt = 0;
      }

      this._lastFaceCount = faceCount;

    } catch (err) {
      console.error('[Proctor] Face detection error:', err);
    } finally {
      this._faceDetecting = false;
    }
  }

  logEvent(type, detail = '') {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    const ev = { time: `${m}:${s}`, event: type, detail, timestamp: new Date().toISOString() };
    this.events.push(ev);

    // Call callback with error handling
    try {
      this._cb.onEvent(ev);
    } catch (e) {
      console.error('[Proctor] onEvent callback error:', e);
    }
  }

  warn(type, message) {
    this.warningCount++;
    this.logEvent(type, message);

    // Call callback with error handling
    try {
      this._cb.onWarning({
        type,
        message,
        count: this.warningCount,
        remaining: Math.max(0, this.maxWarnings - this.warningCount),
      });
    } catch (e) {
      console.error('[Proctor] onWarning callback error:', e);
    }

    if (this.warningCount >= this.maxWarnings) {
      this.logEvent('max_warnings_reached');
      try {
        this._cb.onTerminate({ reason: 'Exceeded maximum violations', events: this.events });
      } catch (e) {
        console.error('[Proctor] onTerminate callback error:', e);
      }
    }
  }

  _attach() {
    // Tab visibility
    this._handlers.visibility = () => {
      if (document.hidden) this.warn('tab_switch', 'Switched to another tab');
      else this.logEvent('tab_return');
    };
    document.addEventListener('visibilitychange', this._handlers.visibility);

    // Window blur / focus
    // this._handlers.blur = () => this.warn('window_blur', 'Left interview window');
    // this._handlers.focus = () => this.logEvent('window_focus');
    // window.addEventListener('blur', this._handlers.blur);
    // window.addEventListener('focus', this._handlers.focus);

    // Fullscreen exit
    this._handlers.fsChange = () => {
      if (!this.isFullscreen()) {
        this.warn('fullscreen_exit', 'Exited fullscreen mode');
        setTimeout(() => this.requestFullscreen(), 2500);
      }
    };
    document.addEventListener('fullscreenchange', this._handlers.fsChange);
    document.addEventListener('webkitfullscreenchange', this._handlers.fsChange);
    document.addEventListener('mozfullscreenchange', this._handlers.fsChange);

    // Copy / Cut (block)
    this._handlers.copy = e => { e.preventDefault(); this.warn('copy_attempt', 'Attempted to copy'); };
    this._handlers.cut = e => { e.preventDefault(); this.logEvent('cut_attempt'); };
    document.addEventListener('copy', this._handlers.copy);
    document.addEventListener('cut', this._handlers.cut);

    // Paste — log but allow
    this._handlers.paste = () => this.logEvent('paste_detected');
    document.addEventListener('paste', this._handlers.paste);

    // Right-click
    this._handlers.ctx = e => { e.preventDefault(); this.logEvent('right_click'); };
    document.addEventListener('contextmenu', this._handlers.ctx);

    // Keyboard shortcuts
    this._handlers.keydown = e => {
      // if (e.key === 'F12') {
      //   e.preventDefault();
      //   return this.warn('devtools_attempt', 'Tried to open DevTools (F12)');
      // }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && 'ijcIJC'.includes(e.key)) {
        e.preventDefault();
        return this.warn('devtools_attempt', 'Tried to open DevTools (Ctrl+Shift+I/J/C)');
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        return this.logEvent('view_source_attempt');
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        return this.logEvent('find_attempt');
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
        this.logEvent('new_tab_attempt');
      }
      if (e.altKey && e.key === 'Tab') this.logEvent('alt_tab_hint');
      if (e.key === 'Escape' && this.isFullscreen()) this.logEvent('escape_pressed');
    };
    document.addEventListener('keydown', this._handlers.keydown);

    // Print
    this._handlers.print = () => this.warn('print_attempt', 'Attempted to print');
    window.addEventListener('beforeprint', this._handlers.print);

    // Mouse leaving viewport
    this._handlers.mouseleave = e => {
      if (e.clientY <= 0 || e.clientX <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        this.logEvent('mouse_left_window');
      }
    };
    document.addEventListener('mouseleave', this._handlers.mouseleave);
  }

  _detach() {
    document.removeEventListener('visibilitychange', this._handlers.visibility);
    // window.removeEventListener('blur', this._handlers.blur);
    // window.removeEventListener('focus', this._handlers.focus);
    document.removeEventListener('fullscreenchange', this._handlers.fsChange);
    document.removeEventListener('webkitfullscreenchange', this._handlers.fsChange);
    document.removeEventListener('mozfullscreenchange', this._handlers.fsChange);
    document.removeEventListener('copy', this._handlers.copy);
    document.removeEventListener('cut', this._handlers.cut);
    document.removeEventListener('paste', this._handlers.paste);
    document.removeEventListener('contextmenu', this._handlers.ctx);
    document.removeEventListener('keydown', this._handlers.keydown);
    window.removeEventListener('beforeprint', this._handlers.print);
    document.removeEventListener('mouseleave', this._handlers.mouseleave);
  }
}

window.ProctoringSystem = ProctoringSystem;