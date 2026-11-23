/**
 * Self-Hosted AI Interviewer Bot — Universal Incoming Audio Tap & Per-Question Recorder.
 *
 * Injected via Playwright `addInitScript` into ALL frames (main + iframes) BEFORE page scripts load.
 * Captures candidate audio across ALL 3 platforms via 3 complementary hooks:
 *   Hook 1: RTCPeerConnection incoming remote audio tracks (Google Meet, Microsoft Teams)
 *   Hook 2: HTMLMediaElement.srcObject setter (DOM <audio>/<video> streams)
 *   Hook 3: AudioNode.prototype.connect(ctx.destination) (Zoom Web Client WASM / AudioWorklet!)
 *
 * Mixes all candidate audio into a single AudioContext destination, records exact per-question
 * `.webm` (Opus) segments, and tracks live RMS amplitude for silence & frame-selection detection.
 */
(() => {
  if (window.__AI_INTERVIEWER_AUDIO__) return;

  const origAudioNodeConnect =
    typeof AudioNode !== "undefined" && AudioNode.prototype && AudioNode.prototype.connect
      ? AudioNode.prototype.connect
      : null;

  let audioCtx = null;
  let mixerDest = null;
  let analyser = null;
  let silentKeepAlive = null;

  const tappedTrackIds = new Set();
  const activeSources = new Map();
  const foreignContextTapMap = new WeakMap(); // Foreign AudioContext -> MediaStreamAudioDestinationNode
  const tappedWebAudioNodes = new WeakSet();  // Prevent double-tapping same AudioNode

  let recorder = null;
  let recordedChunks = [];
  let currentSegmentIndex = -1;
  let segmentStartedAt = 0;

  let lastSpeechAt = 0;
  let peakLevel = 0;
  let segmentMaxRms = 0;
  let levelTimer = null;
  let wasmTapCount = 0;

  function safeConnect(src, dst) {
    if (origAudioNodeConnect) {
      return origAudioNodeConnect.call(src, dst);
    }
    return src.connect(dst);
  }

  function ensureAudioGraph() {
    if (audioCtx && mixerDest) {
      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }
      return true;
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtx();
      audioCtx.__AI_BOT_INTERNAL_CTX__ = true;
      mixerDest = audioCtx.createMediaStreamDestination();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;

      // Tiny silent keep-alive oscillator so MediaRecorder always has a valid clock
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      gain.gain.value = 0.000001;
      safeConnect(osc, gain);
      safeConnect(gain, mixerDest);
      osc.start();
      silentKeepAlive = osc;

      // Monitor live RMS speech energy every 150ms
      const freqData = new Float32Array(analyser.fftSize);
      levelTimer = setInterval(() => {
        if (!analyser) return;
        analyser.getFloatTimeDomainData(freqData);
        let sumSq = 0;
        for (let i = 0; i < freqData.length; i++) {
          sumSq += freqData[i] * freqData[i];
        }
        const rms = Math.sqrt(sumSq / freqData.length);
        peakLevel = rms;
        if (rms > segmentMaxRms) {
          segmentMaxRms = rms;
        }
        if (rms > 0.012) {
          lastSpeechAt = Date.now();
        }
      }, 150);

      return true;
    } catch (e) {
      return false;
    }
  }

  function tapAudioTrack(track) {
    if (!track || track.kind !== "audio") return;
    if (tappedTrackIds.has(track.id)) return;
    if (track.label && track.label.toLowerCase().includes("ai interviewer")) return;

    if (!ensureAudioGraph()) return;

    try {
      tappedTrackIds.add(track.id);
      const stream = new MediaStream([track]);

      // Chromium WebRTC bug workaround (crbug.com/933677):
      // Remote WebRTC audio tracks produce silence in WebAudio unless also bound to a muted <audio> sink.
      let sinkEl = null;
      try {
        sinkEl = document.createElement("audio");
        sinkEl.muted = true;
        sinkEl.autoplay = true;
        sinkEl.srcObject = stream;
        sinkEl.play().catch(() => {});
      } catch (_) {}

      const source = audioCtx.createMediaStreamSource(stream);
      safeConnect(source, mixerDest);
      if (analyser) {
        safeConnect(source, analyser);
      }
      activeSources.set(track.id, { source, sinkEl });

      track.addEventListener("ended", () => {
        tappedTrackIds.delete(track.id);
        const entry = activeSources.get(track.id);
        if (entry) {
          try {
            entry.source.disconnect();
          } catch (_) {}
          if (entry.sinkEl) {
            try {
              entry.sinkEl.srcObject = null;
            } catch (_) {}
          }
          activeSources.delete(track.id);
        }
      });
    } catch (e) {
      tappedTrackIds.delete(track.id);
    }
  }

  function tapStream(stream) {
    if (!stream || typeof stream.getAudioTracks !== "function") return;
    for (const track of stream.getAudioTracks()) {
      tapAudioTrack(track);
    }
  }

  // -------------------------------------------------------------------------
  // Hook 1: RTCPeerConnection incoming remote audio tracks (Google Meet, Teams)
  // -------------------------------------------------------------------------
  const OrigRTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (OrigRTCPeerConnection) {
    const WrappedRTCPeerConnection = function (...args) {
      const pc = new OrigRTCPeerConnection(...args);
      pc.addEventListener("track", (event) => {
        if (event.track && event.track.kind === "audio") {
          tapAudioTrack(event.track);
        }
        if (event.streams) {
          for (const s of event.streams) {
            tapStream(s);
          }
        }
      });
      return pc;
    };
    WrappedRTCPeerConnection.prototype = OrigRTCPeerConnection.prototype;
    Object.setPrototypeOf(WrappedRTCPeerConnection, OrigRTCPeerConnection);
    window.RTCPeerConnection = WrappedRTCPeerConnection;
    if (window.webkitRTCPeerConnection) {
      window.webkitRTCPeerConnection = WrappedRTCPeerConnection;
    }
  }

  // -------------------------------------------------------------------------
  // Hook 2: HTMLMediaElement.srcObject setter (catches remote <audio>/<video>)
  // -------------------------------------------------------------------------
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "srcObject");
    if (desc && desc.set && desc.get) {
      Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
        configurable: true,
        enumerable: true,
        get() {
          return desc.get.call(this);
        },
        set(val) {
          if (val && typeof val.getAudioTracks === "function") {
            if (!this.muted) {
              tapStream(val);
            }
          }
          return desc.set.call(this, val);
        },
      });
    }
  } catch (e) {}

  // -------------------------------------------------------------------------
  // Hook 3: AudioNode.prototype.connect(ctx.destination) — ZOOM WEB WASM AUDIO!
  // Zoom Web Client decodes voice in WebAssembly & plays via AudioWorkletNode /
  // ScriptProcessorNode / AudioBufferSourceNode -> audioCtx.destination.
  // Tapping every foreign node connecting to AudioDestinationNode captures 100%
  // of Zoom Web Client speaker audio with ZERO OS drivers!
  // -------------------------------------------------------------------------
  if (origAudioNodeConnect) {
    AudioNode.prototype.connect = function (destination, ...rest) {
      const result = origAudioNodeConnect.call(this, destination, ...rest);
      try {
        const srcCtx = this && this.context;
        if (
          srcCtx &&
          !srcCtx.__AI_BOT_INTERNAL_CTX__ &&
          destination &&
          destination === srcCtx.destination &&
          typeof srcCtx.createMediaStreamDestination === "function" &&
          !tappedWebAudioNodes.has(this)
        ) {
          tappedWebAudioNodes.add(this);
          let foreignDest = foreignContextTapMap.get(srcCtx);
          if (!foreignDest) {
            foreignDest = srcCtx.createMediaStreamDestination();
            foreignContextTapMap.set(srcCtx, foreignDest);
            tapStream(foreignDest.stream);
          }
          // Tap this speaker-bound node into our foreign MediaStreamAudioDestinationNode
          const outputIdx = typeof rest[0] === "number" ? rest[0] : 0;
          origAudioNodeConnect.call(this, foreignDest, outputIdx);
          wasmTapCount++;
        }
      } catch (_) {}
      return result;
    };
  }

  function pickMimeType() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ];
    for (const m of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) {
        return m;
      }
    }
    return "";
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = String(reader.result || "");
        const comma = res.indexOf(",");
        resolve(comma >= 0 ? res.slice(comma + 1) : res);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Public API called from Python via Playwright evaluate(...)
  window.__AI_INTERVIEWER_AUDIO__ = {
    startSegment(qIndex = 0) {
      if (!ensureAudioGraph()) {
        return { ok: false, error: "AudioContext unavailable" };
      }
      if (recorder && recorder.state === "recording") {
        try {
          recorder.stop();
        } catch (_) {}
      }

      recordedChunks = [];
      currentSegmentIndex = qIndex;
      segmentStartedAt = Date.now();
      segmentMaxRms = 0;

      const mimeType = pickMimeType();
      try {
        recorder = mimeType
          ? new MediaRecorder(mixerDest.stream, { mimeType, audioBitsPerSecond: 64000 })
          : new MediaRecorder(mixerDest.stream);

        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            recordedChunks.push(ev.data);
          }
        };
        recorder.start(500);
        return {
          ok: true,
          qIndex,
          mimeType: recorder.mimeType || mimeType || "audio/webm",
          tappedTracks: tappedTrackIds.size,
          wasmTapCount,
        };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },

    stopSegment() {
      return new Promise((resolve) => {
        const qIdx = currentSegmentIndex;
        const durationMs = segmentStartedAt ? Date.now() - segmentStartedAt : 0;
        const maxRms = segmentMaxRms;

        if (!recorder || recorder.state === "inactive") {
          resolve({
            ok: true,
            qIndex: qIdx,
            mimeType: "audio/webm",
            sizeBytes: 0,
            durationMs,
            maxRms,
            base64: "",
            tappedTracks: tappedTrackIds.size,
            wasmTapCount,
          });
          return;
        }

        const mimeType = recorder.mimeType || "audio/webm";
        recorder.onstop = async () => {
          try {
            const blob = new Blob(recordedChunks, { type: mimeType });
            const b64 = blob.size > 0 ? await blobToBase64(blob) : "";
            recordedChunks = [];
            resolve({
              ok: true,
              qIndex: qIdx,
              mimeType,
              sizeBytes: blob.size,
              durationMs,
              maxRms,
              base64: b64,
              tappedTracks: tappedTrackIds.size,
              wasmTapCount,
            });
          } catch (e) {
            resolve({ ok: false, qIndex: qIdx, error: String(e), sizeBytes: 0, maxRms, base64: "" });
          }
        };

        try {
          recorder.stop();
        } catch (e) {
          resolve({ ok: false, qIndex: qIdx, error: String(e), sizeBytes: 0, maxRms, base64: "" });
        }
      });
    },

    getStatus() {
      return {
        tappedTracks: tappedTrackIds.size,
        wasmTapCount,
        recording: Boolean(recorder && recorder.state === "recording"),
        currentSegmentIndex,
        rmsLevel: peakLevel,
        segmentMaxRms,
        lastSpeechAt,
        msSinceSpeech: lastSpeechAt ? Date.now() - lastSpeechAt : null,
      };
    },

    tapExternalStream(stream) {
      tapStream(stream);
      return { tappedTracks: tappedTrackIds.size, wasmTapCount };
    },

    getMixedAudioTrack() {
      try {
        if (mixerDest && mixerDest.stream) {
          const tracks = mixerDest.stream.getAudioTracks();
          if (tracks.length > 0) return tracks[0];
        }
      } catch (e) {}
      return null;
    },
  };
})();
