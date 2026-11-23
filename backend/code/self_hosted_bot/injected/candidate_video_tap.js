/**
 * Self-Hosted AI Interviewer Bot — Candidate Face Video Grabber & Continuous Session Recorder.
 *
 * Injected into Playwright Chromium sessions to:
 * 1. Continuously detect & isolate the candidate's camera video tile in Zoom, Google Meet, or MS Teams.
 * 2. Broadcast live JPEG snapshots every 1.2s to Python via `window.__onCandidateCameraFrame`
 *    for real-time Admin Live View monitoring (/ws/view-camera/{username}).
 * 3. Record the candidate's face video + candidate audio into a standard .webm video file
 *    via in-browser MediaRecorder for post-interview playback in the Admin Scorecard.
 */
(() => {
  if (window.__AI_CANDIDATE_VIDEO__) return;

  const WIDTH = 640;
  const HEIGHT = 360;
  const FPS = 15;

  let canvas = null;
  let ctx = null;
  let renderTimer = null;
  let liveBroadcastTimer = null;

  let recorder = null;
  let recordedChunks = [];
  let recordingStartedAt = 0;
  let isRecording = false;

  let candidateName = "Candidate";
  let hasActiveCandidateStream = false;
  let frameCount = 0;
  let lastSuccessfulFrameTime = 0;
  const FALLBACK_GRACE_PERIOD_MS = 2500;

  function ensureCanvas() {
    if (canvas && ctx) return true;
    if (typeof document === "undefined") return false;
    canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    ctx = canvas.getContext("2d", { alpha: false });
    return true;
  }

  /**
   * Find candidate video/canvas across Google Meet, Microsoft Teams, and Zoom Web.
   */
  function findCandidateElement() {
    if (typeof document === "undefined") return null;

    // 1. Google Meet & Microsoft Teams & Zoom Web: look for active <video> elements
    const videos = Array.from(document.querySelectorAll("video"));
    for (const v of videos) {
      try {
        if (v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
          // Exclude the bot's own question display canvas or virtual preview
          if (v.hasAttribute("data-ai-bot-virtual-preview") || v.__isAiInterviewerBot) {
            continue;
          }

          const isVirtualCam = v.srcObject && (
            v.srcObject.__isAiInterviewerBot ||
            (v.srcObject.getVideoTracks && v.srcObject.getVideoTracks().some(t =>
              t.__isAiInterviewerBot ||
              (t.label || "").includes("AI Interviewer") ||
              (t.label || "").toLowerCase().includes("canvas")
            ))
          );
          if (isVirtualCam) continue;

          // Exclude self-view tiles if detectable by aria labels or classes
          const parent = v.closest("[data-self-name], [aria-label*='Your presentation'], .self-view, [class*='self-video'], [class*='local-video']");
          if (parent) continue;

          // Exclude self-view indicators on video tag itself
          if ((v.className && typeof v.className === "string" && (v.className.includes("self") || v.className.includes("local"))) ||
              (v.getAttribute("aria-label") || "").toLowerCase().includes("you")) {
            continue;
          }

          return v;
        }
      } catch (e) {
        continue;
      }
    }

    // 2. Zoom Web Client: check for Zoom WebAssembly video canvases
    const canvases = Array.from(document.querySelectorAll("canvas"));
    for (const c of canvases) {
      try {
        // Exclude bot's own question display canvas!
        if (c.getAttribute("data-ai-bot-display") === "true" || c.id === "ai-interviewer-display-canvas" || c.__isAiInterviewerBot) {
          continue;
        }

        if (c.id === "video-canvas" || (c.className && typeof c.className === "string" && (c.className.includes("main-canvas") || c.className.includes("speaker-canvas")))) {
          if (c.width > 0 && c.height > 0) {
            return c;
          }
        }
      } catch (e) {
        continue;
      }
    }

    return null;
  }

  /**
   * Render candidate avatar fallback when candidate camera is muted or not joined yet.
   */
  function renderFallbackTile() {
    if (!ctx) return;
    // Dark sleek background matching platform theme
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Subtle center box
    ctx.fillStyle = "#1e293b";
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(WIDTH / 2 - 120, HEIGHT / 2 - 70, 240, 140, 16) : ctx.rect(WIDTH / 2 - 120, HEIGHT / 2 - 70, 240, 140);
    ctx.fill();

    // Initials Avatar Circle
    ctx.fillStyle = "#3b82f6";
    ctx.beginPath();
    ctx.arc(WIDTH / 2, HEIGHT / 2 - 15, 32, 0, Math.PI * 2);
    ctx.fill();

    // Initial Letter
    const initial = (candidateName || "C").trim().charAt(0).toUpperCase();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 24px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initial, WIDTH / 2, HEIGHT / 2 - 14);

    // Candidate Name
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 13px -apple-system, sans-serif";
    ctx.fillText(candidateName || "Candidate", WIDTH / 2, HEIGHT / 2 + 30);

    // Status
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px -apple-system, sans-serif";
    ctx.fillText("Camera Muted / Connecting...", WIDTH / 2, HEIGHT / 2 + 48);
  }

  /**
   * Main render loop drawing the active candidate stream to offscreen canvas.
   * Uses frame smoothing grace period to eliminate rapid blinking/flickering.
   */
  function renderFrame() {
    if (!ensureCanvas()) return;
    frameCount++;

    const targetEl = findCandidateElement();
    if (targetEl) {
      try {
        ctx.drawImage(targetEl, 0, 0, WIDTH, HEIGHT);
        hasActiveCandidateStream = true;
        lastSuccessfulFrameTime = Date.now();
      } catch (e) {
        if (Date.now() - lastSuccessfulFrameTime >= FALLBACK_GRACE_PERIOD_MS) {
          renderFallbackTile();
          hasActiveCandidateStream = false;
        }
      }
    } else {
      if (Date.now() - lastSuccessfulFrameTime >= FALLBACK_GRACE_PERIOD_MS) {
        renderFallbackTile();
        hasActiveCandidateStream = false;
      }
    }
  }

  function startRenderLoop() {
    if (renderTimer) return;
    ensureCanvas();
    renderTimer = setInterval(renderFrame, 1000 / FPS);

    // Broadcast live camera frame every 1200ms to Admin Live View
    if (!liveBroadcastTimer) {
      liveBroadcastTimer = setInterval(() => {
        try {
          if (!canvas) return;
          const jpeg = canvas.toDataURL("image/jpeg", 0.35);
          if (typeof window.__onCandidateCameraFrame === "function") {
            window.__onCandidateCameraFrame(jpeg);
          }
        } catch (e) {}
      }, 1200);
    }
  }

  function stopRenderLoop() {
    if (renderTimer) {
      clearInterval(renderTimer);
      renderTimer = null;
    }
    if (liveBroadcastTimer) {
      clearInterval(liveBroadcastTimer);
      liveBroadcastTimer = null;
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result;
        if (typeof res === "string") {
          const idx = res.indexOf(",");
          resolve(idx >= 0 ? res.slice(idx + 1) : res);
        } else {
          resolve("");
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  startRenderLoop();

  // Public candidate video controller
  window.__AI_CANDIDATE_VIDEO__ = {
    setCandidateName(name) {
      candidateName = name || "Candidate";
    },

    getSnapshotDataUrl() {
      ensureCanvas();
      renderFrame();
      return canvas ? canvas.toDataURL("image/jpeg", 0.4) : null;
    },

    startRecording(name = "Candidate") {
      candidateName = name;
      ensureCanvas();
      startRenderLoop();

      if (recorder && recorder.state === "recording") {
        return { ok: true, alreadyRecording: true };
      }

      recordedChunks = [];
      recordingStartedAt = Date.now();

      try {
        const videoStream = canvas.captureStream(FPS);
        const tracks = [...videoStream.getVideoTracks()];

        // If candidate audio is available from audio_tap.js, attach it
        if (window.__AI_INTERVIEWER_AUDIO__ && typeof window.__AI_INTERVIEWER_AUDIO__.getMixedAudioTrack === "function") {
          const at = window.__AI_INTERVIEWER_AUDIO__.getMixedAudioTrack();
          if (at) tracks.push(at);
        }

        const fullStream = new MediaStream(tracks);
        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
          ? "video/webm;codecs=vp8,opus"
          : (MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "");

        recorder = new MediaRecorder(fullStream, {
          mimeType,
          videoBitsPerSecond: 600000,
        });

        recorder.ondataavailable = async (e) => {
          if (e.data && e.data.size > 0) {
            recordedChunks.push(e.data);
            try {
              const b64 = await blobToBase64(e.data);
              if (b64 && typeof window.__onCandidateVideoChunk === "function") {
                window.__onCandidateVideoChunk(b64);
              }
            } catch (err) {}
          }
        };

        recorder.start(1000); // 1-second chunks
        isRecording = true;
        return { ok: true, mimeType, recording: true };
      } catch (e) {
        isRecording = false;
        return { ok: false, error: String(e) };
      }
    },

    async stopRecording() {
      if (!recorder || recorder.state === "inactive") {
        isRecording = false;
        return { ok: false, error: "No active recording", sizeBytes: 0, base64: "" };
      }

      return new Promise((resolve) => {
        const mimeType = recorder.mimeType || "video/webm";
        const durationSec = Math.max(1, Math.round((Date.now() - recordingStartedAt) / 1000));

        recorder.onstop = async () => {
          try {
            isRecording = false;
            const blob = new Blob(recordedChunks, { type: mimeType });
            const b64 = blob.size > 0 ? await blobToBase64(blob) : "";
            recordedChunks = [];
            resolve({
              ok: true,
              sizeBytes: blob.size,
              durationSec,
              mimeType,
              base64: b64,
            });
          } catch (err) {
            isRecording = false;
            resolve({ ok: false, error: String(err), sizeBytes: 0, base64: "" });
          }
        };

        try {
          recorder.stop();
        } catch (e) {
          isRecording = false;
          resolve({ ok: false, error: String(e), sizeBytes: 0, base64: "" });
        }
      });
    },

    getStatus() {
      return {
        recording: isRecording,
        hasActiveCandidateStream,
        candidateName,
        frameCount,
        recordedChunksCount: recordedChunks.length,
      };
    },
  };
})();
