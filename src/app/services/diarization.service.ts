import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

/**
 * DiarizationService
 * ------------------
 * Streams 16 kHz PCM-16 audio to the backend /ws/diarize endpoint
 * and fires a callback when the server detects multiple speakers.
 *
 * FIX SUMMARY
 * ─────────────────────────────────────────────────────────────────
 * 1. Replaced deprecated ScriptProcessorNode (onaudioprocess) with
 *    AnalyserNode + setInterval(100 ms). ScriptProcessorNode silently
 *    stops firing in background tabs and modern Chromium builds.
 *
 * 2. Added a JSON ping heartbeat (every 10 s) so the WebSocket stays
 *    alive through NAT/proxy idle-timeout rules.
 *
 * 3. Backend /ws/diarize now receives TWO message types:
 *      • text  → {"type":"ping"} / {"type":"init","username":"..."}
 *      • bytes → raw Int16 PCM at 16 kHz
 *    The backend routes.py fix handles both correctly.
 *
 * 4. Manual linear downsampling from the capture sample rate
 *    (44100 Hz typical) to 16000 Hz before sending, matching the
 *    webrtcvad frame size expected on the server.
 * ─────────────────────────────────────────────────────────────────
 */
@Injectable({ providedIn: 'root' })
export class DiarizationService {

  // ── State ──────────────────────────────────────────────────────
  private ws:             WebSocket | null       = null;
  private audioCtx:       AudioContext | null    = null;
  private source:         MediaStreamAudioSourceNode | null = null;
  private analyser:       AnalyserNode | null    = null;
  private pollIntervalId: any                    = null;
  private pingIntervalId: any                    = null;
  private running        = false;

  // Capture buffer: accumulate downsampled samples until we have
  // exactly one 30 ms webrtcvad frame (16000 × 0.030 × 2 = 960 bytes).
  private readonly TARGET_RATE   = 16000;
  private readonly FRAME_MS      = 32;
  // private readonly FRAME_SAMPLES = (this.TARGET_RATE * this.FRAME_MS) / 1000; // 480 samples
  // private readonly FRAME_BYTES   = this.FRAME_SAMPLES * 2;                    // 960 bytes (Int16)
  private readonly FRAME_SAMPLES = 512;  // Exact Silero frame size
  private readonly FRAME_BYTES   = 1024; // 512 * 2 bytes (Int16)
  private sampleAccumulator: number[] = [];

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Start diarization monitoring.
   *
   * @param username  Student's username (sent to server as init msg)
   * @param stream    The MediaStream containing the microphone audio track
   * @param callback  Called with (type, detail) when a violation fires;
   *                  type === 'multiple_speakers_detected' on a hit
   */
  start(
    username: string,
    stream:   MediaStream,
    callback: (type: string, detail: string) => void
  ): void {
    if (this.running) {
      console.warn('[Diarization] Already running — stop() first');
      return;
    }
    if (!stream || stream.getAudioTracks().length === 0) {
      console.warn('[Diarization] No audio track in stream — skipping');
      return;
    }

    this.running = true;
    this.sampleAccumulator = [];

    // ── 1. Open WebSocket ────────────────────────────────────────
    const wsUrl = this.buildWsUrl('/ws/diarize');
    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('[Diarization] WS connected →', wsUrl);
        // Send text init frame (username registration)
        this.wsSendText({ type: 'init', username });
        // Start keepalive ping every 10 s
        this.pingIntervalId = setInterval(() => {
          this.wsSendText({ type: 'ping' });
        }, 10_000);
      };
      
      this.ws.onmessage = (event) => {
        try {
          const msg = typeof event.data === 'string' ? JSON.parse(event.data) : null;
          if (!msg) return;
          if (msg.type === 'pong') return;

          if (msg.type === 'audio_violation') {
            const detail = (msg.detail || '').toLowerCase();
            
            // 🛡️ IGNORE LOW-CONFIDENCE / UNCERTAIN BACKEND FLAGS
            if (detail.includes('uncertain') || 
                detail.includes('quiet') || 
                detail.includes('silero') ||
                msg.level !== 'high') {
              console.log('[Diarization] 🛡️ Ignoring low-confidence flag:', msg.detail);
              return; // Callback mat call karo, violation counter nahi badhega
            }

            // ✅ Sirf confident overlaps hi pass karo
            console.warn('[Diarization] ✅ High-confidence violation:', msg.detail);
            callback('multiple_speakers_detected', `source=${msg.source ?? 'server'}`);
          }
        } catch {
          // Non-JSON frame — ignore
        }
      };

      this.ws.onerror  = (err) => console.error('[Diarization] WS error:', err);
      this.ws.onclose  = (ev)  => console.log(`[Diarization] WS closed — code=${ev.code}`);

    } catch (err) {
      console.error('[Diarization] Could not open WebSocket:', err);
      this.running = false;
      return;
    }

    // ── 2. Build AnalyserNode audio graph ────────────────────────
    try {
      // Use capture sample rate; we downsample manually before sending
      this.audioCtx = new AudioContext();
      this.source   = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();

      // fftSize must be power-of-2; 2048 gives ~46 ms windows at 44100 Hz
      this.analyser.fftSize              = 2048;
      this.analyser.smoothingTimeConstant = 0.0; // no smoothing — we need raw data

      this.source.connect(this.analyser);
      // NOTE: AnalyserNode deliberately NOT connected to destination;
      // it works as a pure "tap" without routing audio to speakers.

      const captureRate = this.audioCtx.sampleRate;           // typically 44100
      const timeData    = new Float32Array(this.analyser.fftSize);

      // ── 3. Poll every 100 ms, downsample, send PCM chunks ───────
      this.pollIntervalId = setInterval(() => {
        if (!this.running || !this.analyser || !this.audioCtx) return;
        if (this.audioCtx.state === 'closed') return;

        this.analyser.getFloatTimeDomainData(timeData);
        this.downsampleAndQueue(timeData, captureRate);
      }, 20);

      this.audioCtx.resume().then(() => {
        console.log('[Diarization] Audio graph active — polling 100 ms');
      });

    } catch (err) {
      console.error('[Diarization] Audio setup failed:', err);
      this.running = false;
    }
  }

  /** Stop streaming and release all resources */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.pollIntervalId) { clearInterval(this.pollIntervalId); this.pollIntervalId = null; }
    if (this.pingIntervalId) { clearInterval(this.pingIntervalId); this.pingIntervalId = null; }

    if (this.analyser) { this.analyser.disconnect(); this.analyser = null; }
    if (this.source)   { this.source.disconnect();   this.source   = null; }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN ||
          this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'exam ended');
      }
      this.ws = null;
    }

    this.sampleAccumulator = [];
    console.log('[Diarization] Stopped');
  }

  // ── Private helpers ────────────────────────────────────────────

  /**
   * Linear downsample Float32 samples from `fromRate` to TARGET_RATE (16 kHz),
   * append to the accumulator, then flush complete 30 ms frames to the server.
   */
  private downsampleAndQueue(samples: Float32Array, fromRate: number): void {
    if (fromRate === this.TARGET_RATE) {
      // No resampling needed
      for (let i = 0; i < samples.length; i++) {
        this.sampleAccumulator.push(samples[i]);
      }
    } else {
      // Linear interpolation downsample
      const ratio      = fromRate / this.TARGET_RATE;
      const outLength  = Math.floor(samples.length / ratio);
      for (let i = 0; i < outLength; i++) {
        const srcIdx = i * ratio;
        const lo     = Math.floor(srcIdx);
        const hi     = Math.min(lo + 1, samples.length - 1);
        const frac   = srcIdx - lo;
        this.sampleAccumulator.push(samples[lo] * (1 - frac) + samples[hi] * frac);
      }
    }

    // Flush complete frames
    while (this.sampleAccumulator.length >= this.FRAME_SAMPLES) {
      const frame = this.sampleAccumulator.splice(0, this.FRAME_SAMPLES);
      this.sendPcmFrame(frame);
    }
  }

  /**
   * Convert Float32 samples (−1 … +1) → Int16 PCM bytes and send over WS.
   * webrtcvad on the server expects signed 16-bit little-endian PCM.
   */
  private sendPcmFrame(samples: number[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const buffer = new ArrayBuffer(samples.length * 2);
    const view   = new DataView(buffer);
    for (let i = 0; i < samples.length; i++) {
      // Clamp, scale, convert to signed Int16
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(i * 2, clamped * 0x7fff, /* littleEndian = */ true);
    }
    this.ws.send(buffer);
  }

  /** Send a JSON control message as a text WebSocket frame */
  private wsSendText(payload: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (err) {
      console.warn('[Diarization] wsSendText failed:', err);
    }
  }

  private buildWsUrl(path: string): string {
    return environment.apiUrl.replace(/^http/, 'ws') + path;
  }
}