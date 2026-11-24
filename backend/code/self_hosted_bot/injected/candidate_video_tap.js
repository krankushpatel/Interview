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

  let tappedRemoteVideo = null;

  // Intercept WebGL & WebGL2 getContext before any Zoom/Meet/Teams scripts run
  // Force preserveDrawingBuffer: true so WebAssembly/WebGL video canvases can be read
  // by 2D ctx.drawImage / toDataURL / captureStream without returning blank black pixels!
  try {
    if (typeof HTMLCanvasElement !== "undefined" && HTMLCanvasElement.prototype.getContext) {
      const origCanvasGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, attributes) {
        if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
          attributes = Object.assign({}, attributes, { preserveDrawingBuffer: true });
        }
        return origCanvasGetContext.call(this, type, attributes);
      };
    }
    if (typeof OffscreenCanvas !== "undefined" && OffscreenCanvas.prototype.getContext) {
      const origOffscreenGetContext = OffscreenCanvas.prototype.getContext;
      OffscreenCanvas.prototype.getContext = function (type, attributes) {
        if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
          attributes = Object.assign({}, attributes, { preserveDrawingBuffer: true });
        }
        return origOffscreenGetContext.call(this, type, attributes);
      };
    }
  } catch (e) {}

  // Intercept WebRTC RTCPeerConnection remote video tracks (Google Meet, Teams, WebRTC Zoom)
  try {
    if (typeof window !== "undefined" && window.RTCPeerConnection) {
      const origAddEventListener = RTCPeerConnection.prototype.addEventListener;
      RTCPeerConnection.prototype.addEventListener = function (type, listener, options) {
        if (type === "track") {
          const wrappedListener = function (event) {
            captureRemoteVideoTrack(event);
            return listener.apply(this, arguments);
          };
          return origAddEventListener.call(this, type, wrappedListener, options);
        }
        return origAddEventListener.apply(this, arguments);
      };

      const origOntrackDesc = Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, "ontrack");
      if (origOntrackDesc && origOntrackDesc.set) {
        Object.defineProperty(RTCPeerConnection.prototype, "ontrack", {
          set(fn) {
            const wrapped = function (event) {
              captureRemoteVideoTrack(event);
              if (typeof fn === "function") return fn.apply(this, arguments);
            };
            return origOntrackDesc.set.call(this, wrapped);
          },
          get() {
            return origOntrackDesc.get ? origOntrackDesc.get.call(this) : null;
          },
        });
      }
    }
  } catch (e) {}

  function captureRemoteVideoTrack(event) {
    try {
      if (!event || !event.track || event.track.kind !== "video") return;
      if (event.track.__isAiInterviewerBot) return;

      if (!tappedRemoteVideo) {
        tappedRemoteVideo = document.createElement("video");
        tappedRemoteVideo.autoplay = true;
        tappedRemoteVideo.muted = true;
        tappedRemoteVideo.playsInline = true;
        tappedRemoteVideo.setAttribute("data-ai-tapped-remote", "true");
        tappedRemoteVideo.style.position = "fixed";
        tappedRemoteVideo.style.opacity = "0";
        tappedRemoteVideo.style.pointerEvents = "none";
        tappedRemoteVideo.style.zIndex = "-9999";
        (document.body || document.documentElement).appendChild(tappedRemoteVideo);
      }
      const stream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);
      tappedRemoteVideo.srcObject = stream;
      tappedRemoteVideo.play().catch(() => {});
    } catch (e) {}
  }

  function getAllDocuments() {
    const docs = [document];
    try {
      const iframes = Array.from(document.querySelectorAll("iframe"));
      for (const f of iframes) {
        try {
          if (f.contentDocument && f.contentDocument.body) {
            docs.push(f.contentDocument);
          }
        } catch (e) {}
      }
    } catch (e) {}
    return docs;
  }

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

    // 0. Primary: Directly tapped WebRTC remote video track
    // In Zoom Web, dummy audio/control tracks or inactive tracks can report 2x2.
    // A real candidate video track has width >= 50.
    if (tappedRemoteVideo && tappedRemoteVideo.readyState >= 2 && tappedRemoteVideo.videoWidth >= 50) {
      return tappedRemoteVideo;
    }

    const docs = getAllDocuments();

    // 1. Google Meet & Microsoft Teams & Zoom Web: look for active <video> elements
    const allFoundVideos = [];
    for (const doc of docs) {
      const videos = Array.from(doc.querySelectorAll("video"));
      for (const v of videos) {
        try {
          // Must have actual video dimensions (> 50px) to skip 0x0 or 2x2 placeholder streams
          if (v.readyState >= 2 && v.videoWidth >= 50 && v.videoHeight >= 50) {
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

            // Collect ALL valid videos first, classify them
            const parentSelf = v.closest("[data-self-name], [aria-label*='Your presentation'], .self-view, [class*='self-video'], [class*='local-video']");
            const classSelf = (v.className && typeof v.className === "string" && (v.className.includes("self") || v.className.includes("local")));
            const ariaSelf = (v.getAttribute("aria-label") || "").toLowerCase().includes("you");
            const isSelfView = !!(parentSelf || classSelf || ariaSelf);

            allFoundVideos.push({ video: v, isSelfView, area: v.videoWidth * v.videoHeight });
          }
        } catch (e) {
          continue;
        }
      }
    }

    // Try non-self videos first (sorted by area, largest first)
    const remoteVideos = allFoundVideos.filter(v => !v.isSelfView);
    if (remoteVideos.length > 0) {
      remoteVideos.sort((a, b) => b.area - a.area);
      return remoteVideos[0].video;
    }

    // 2. Zoom Web Client: check for Zoom WebAssembly / WebGL video canvases in any document/iframe
    const candidateCanvases = [];
    for (const doc of docs) {
      const canvases = Array.from(doc.querySelectorAll("canvas"));
      for (const c of canvases) {
        try {
          if (c.getAttribute("data-ai-bot-display") === "true" || c.id === "ai-interviewer-display-canvas" || c.__isAiInterviewerBot) {
            continue;
          }

          // Exclude self-view thumbnail (bot's virtual question card preview)
          const isSelf = Boolean(c.closest("[data-self-name], [aria-label*='Your presentation'], [data-ai-bot-display='true']"));
          if (isSelf) continue;

          const w = c.clientWidth || c.width || 0;
          const h = c.clientHeight || c.height || 0;
          const area = w * h;

          // In Zoom Web Client: video is rendered to WebAssembly/WebGL canvas
          // Elements have IDs/classes like #video-canvas, .speaker-canvas, .gallery-video-canvas
          // Or any large canvas (> 150x100) that is not our virtual question card
          const isZoomVideoCanvas =
            c.id === "video-canvas" ||
            c.id.includes("speaker") ||
            c.id.includes("video") ||
            c.id.includes("sharing") ||
            (c.className && typeof c.className === "string" && (
              c.className.includes("main-canvas") ||
              c.className.includes("speaker-canvas") ||
              c.className.includes("gallery-video-canvas") ||
              c.className.includes("video-canvas") ||
              c.className.includes("video-avatar") ||
              c.className.includes("sharing-canvas")
            )) ||
            Boolean(c.closest(".speaker-active-container, .speaker-bar-container, .video-avatar__avatar-footer, .gallery-video-container, [data-testid='video-player'], .main-view")) ||
            (w >= 120 && h >= 80);

          if (isZoomVideoCanvas && area > 0) {
            candidateCanvases.push({ canvas: c, area });
          }
        } catch (e) {
          continue;
        }
      }
    }

    if (candidateCanvases.length > 0) {
      candidateCanvases.sort((a, b) => b.area - a.area);
      return candidateCanvases[0].canvas;
    }

    // Broad fallback: In Zoom Web Client, if no canvas matched the specific class names,
    // take ANY non-bot canvas that has positive area
    const anyCanvas = [];
    for (const doc of docs) {
      const canvases = Array.from(doc.querySelectorAll("canvas"));
      for (const c of canvases) {
        if (c.getAttribute("data-ai-bot-display") === "true" || c.id === "ai-interviewer-display-canvas" || c.__isAiInterviewerBot) {
          continue;
        }
        const w = c.clientWidth || c.width || 0;
        const h = c.clientHeight || c.height || 0;
        if (w >= 80 && h >= 60) {
          anyCanvas.push({ canvas: c, area: w * h });
        }
      }
    }
    if (anyCanvas.length > 0) {
      anyCanvas.sort((a, b) => b.area - a.area);
      return anyCanvas[0].canvas;
    }

    // Fallback: If only self-view videos exist, pick the non-bot video
    if (allFoundVideos.length > 0) {
      allFoundVideos.sort((a, b) => b.area - a.area);
      if (allFoundVideos.length >= 2) {
        return allFoundVideos[1].video;
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
  // Diagnostic: periodically log what elements are found
  let _diagCounter = 0;
  function renderFrame() {
    if (!ensureCanvas()) return;
    frameCount++;
    _diagCounter++;

    const targetEl = findCandidateElement();

    // Log diagnostics every 60 frames (~4 seconds at 15fps)
    if (_diagCounter % 60 === 1) {
      try {
        const allVids = Array.from(document.querySelectorAll("video"));
        const allCanvas = Array.from(document.querySelectorAll("canvas"));
        const vidInfo = allVids.map(v => ({
          id: v.id, cls: (v.className||"").substring(0,50),
          ready: v.readyState, w: v.videoWidth, h: v.videoHeight,
          isBot: !!(v.__isAiInterviewerBot || v.hasAttribute("data-ai-bot-virtual-preview")),
          src: v.src ? v.src.substring(0,30) : (v.srcObject ? "MediaStream" : "none")
        }));
        const canvasInfo = allCanvas.map(c => ({
          id: c.id, cls: (c.className||"").substring(0,50),
          w: c.clientWidth || c.width, h: c.clientHeight || c.height,
          isBot: !!(c.__isAiInterviewerBot || c.getAttribute("data-ai-bot-display")==="true")
        }));
        console.log("[CandidateVideoTap] DIAG: tappedRemote=" + (tappedRemoteVideo ? ("readyState="+tappedRemoteVideo.readyState+",w="+tappedRemoteVideo.videoWidth) : "null") +
          " | videos=" + JSON.stringify(vidInfo) +
          " | canvases=" + JSON.stringify(canvasInfo) +
          " | target=" + (targetEl ? (targetEl.tagName + "#" + targetEl.id) : "null"));
      } catch(e) {}
    }

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
          // ONLY broadcast if we have an ACTUAL live candidate video stream!
          // NEVER broadcast the static fallback avatar circle to Admin Live View!
          // Screencast stream from CDP handles broadcasting real visual frames when stream is not direct.
          if (!hasActiveCandidateStream) return;

          const jpeg = canvas.toDataURL("image/jpeg", 0.35);
          // Try current window, parent, and top to handle iframe contexts
          // page.expose_function only binds to the main frame's window
          const fn = (typeof window.__onCandidateCameraFrame === "function") ? window.__onCandidateCameraFrame
            : (typeof window.parent !== "undefined" && typeof window.parent.__onCandidateCameraFrame === "function") ? window.parent.__onCandidateCameraFrame
            : (typeof window.top !== "undefined" && typeof window.top.__onCandidateCameraFrame === "function") ? window.top.__onCandidateCameraFrame
            : null;
          if (fn) {
            fn(jpeg);
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

    getDiagnostics() {
      const allVids = Array.from(document.querySelectorAll("video"));
      const allCanvas = Array.from(document.querySelectorAll("canvas"));
      return {
        tappedRemote: tappedRemoteVideo ? { readyState: tappedRemoteVideo.readyState, w: tappedRemoteVideo.videoWidth, h: tappedRemoteVideo.videoHeight } : null,
        hasActiveCandidateStream,
        frameCount,
        videos: allVids.map(v => ({ id: v.id, cls: (v.className||"").substring(0,80), ready: v.readyState, w: v.videoWidth, h: v.videoHeight, isBot: !!(v.__isAiInterviewerBot), hasSrcObj: !!v.srcObject })),
        canvases: allCanvas.map(c => ({ id: c.id, cls: (c.className||"").substring(0,80), w: c.clientWidth||c.width, h: c.clientHeight||c.height, isBot: !!(c.__isAiInterviewerBot) })),
        target: (() => { const t = findCandidateElement(); return t ? { tag: t.tagName, id: t.id, cls: (t.className||"").substring(0,80) } : null; })()
      };
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
      const now = Date.now();
      return {
        recording: isRecording,
        hasActiveCandidateStream,
        candidateName,
        frameCount,
        recordedChunksCount: recordedChunks.length,
        msSinceLastActive: lastSuccessfulFrameTime > 0 ? (now - lastSuccessfulFrameTime) : 999999,
      };
    },

    isCandidateScreenSharing() {
      try {
        const pres = document.querySelector(
          '[data-is-presentation="true"], [data-requested-participant-id*="presentation"], [data-participant-id*="presentation"], [data-tid="presentation-surface"], [data-tid="screenshare-video-tile"], [data-tid*="screen-share"], canvas.share-screen-canvas, #share-screen-canvas'
        );
        if (pres && (pres.offsetParent !== null || pres.clientWidth > 0)) return true;

        const videos = Array.from(document.querySelectorAll("video"));
        return videos.some(v => {
          if (v.__isAiInterviewerBot || v.hasAttribute("data-ai-bot-virtual-preview")) return false;
          const parent = v.closest('[data-requested-participant-id*="presentation"], [data-tid*="presentation"], [data-tid*="screenshare"], [class*="presentation"], [class*="screenshare"]');
          return Boolean(parent);
        });
      } catch (e) {
        return false;
      }
    },
  };
})();
