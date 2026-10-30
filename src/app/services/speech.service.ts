import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../environments/environment';

export type STTEngine = 'deepgram' | 'webkit' | 'none';

@Injectable({ providedIn: 'root' })
export class SpeechService {
  // ─── Public observables ───
  private transcriptSource = new Subject<string>();
  transcript$ = this.transcriptSource.asObservable();

  private finalTranscriptSource = new Subject<string>();
  finalTranscript$ = this.finalTranscriptSource.asObservable();

  private engineSource = new Subject<STTEngine>();
  engine$ = this.engineSource.asObservable();

  private confidenceSource = new Subject<number>();
  confidence$ = this.confidenceSource.asObservable();

  // ─── State ───
  private currentEngine: STTEngine = 'none';
  private accumulatedTranscript = '';
  private isListening = false;
  private shouldKeepListening = false;
  private micActive = true;
  private reconnecting = false;
  private reconnectTimer: any = null;

  // Deepgram state
  // private dgWebSocket: WebSocket | null = null;
  // private dgAudioContext: AudioContext | null = null;
  // private dgStream: MediaStream | null = null;
  // private dgWorkletNode: AudioWorkletNode | null = null;
  
  // ─── Deepgram state ───
  private dgWebSocket: WebSocket | null = null;
  private dgAudioContext: AudioContext | null = null;
  private dgStream: MediaStream | null = null;
  private dgScriptNode: ScriptProcessorNode | null = null;
  private dgGainNode: GainNode | null = null;
  private deepgramConnected = false;
  private deepgramSettingsSent = false;
  private keepAliveInterval: any = null;
  private audioPreBuffer: ArrayBuffer[] = [];
  private lastUsername = '';
  private lastSessionId = '';
  private currentKeywords: string[] = [];

  // True right after a completed sentence (speech_final) — next committed
  // chunk should start with a capital letter, matching natural writing.
  private capitalizeNextChunk = true;

  // webkit fallback state
  private recognition: any = null;
  private restartTimeout: any = null;

  // ─── Public API ───

  getIsListening(): boolean { return this.isListening; }
  getEngine(): STTEngine { return this.currentEngine; }
  getFinalTranscript(): string { return this.accumulatedTranscript.trim(); }
  isSupported(): boolean {
    return typeof window !== 'undefined' &&
      (('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window));
  }

  setMicActive(active: boolean): void {
    this.micActive = active;
    console.log('[SPEECH] Mic active set to:', active);
    if (active) {
      this.isListening = true;
      if (this.dgWebSocket?.readyState === WebSocket.OPEN) {
        this.flushAudioPreBuffer();
      }
    }
  }

  deduplicateKeywords(keywords: string[]): string[] {
    const map = new Map<string, string>();
    for (const kw of keywords) {
      if (!kw || typeof kw !== 'string') continue;
      const clean = kw.trim();
      if (!clean) continue;
      const lower = clean.toLowerCase();
      if (!map.has(lower)) {
        map.set(lower, clean);
      } else {
        const prev = map.get(lower)!;
        const prevCaps = (prev.match(/[A-Z]/g) || []).length;
        const currCaps = (clean.match(/[A-Z]/g) || []).length;
        if (currCaps > prevCaps) {
          map.set(lower, clean);
        }
      }
    }
    return Array.from(map.values());
  }

  normalizePhoneticDomainTerms(text: string, activeKeywords: string[] = []): string {
    if (!text) return text;
    let res = text;
    const lowerKws = new Set(activeKeywords.map(k => k.toLowerCase()));

    // Target specific domain misrecognitions
    if (lowerKws.has('pmos')) {
      res = res.replace(/\b(p[\s\-]*(?:mass|moss|mos|fat|mose)|pea[\s\-]*moss)\b/gi, 'PMOS');
    }
    if (lowerKws.has('nmos')) {
      res = res.replace(/\b(n[\s\-]*(?:mass|moss|mos|fat|mose)|knee[\s\-]*moss)\b/gi, 'NMOS');
    }
    if (lowerKws.has('cmos')) {
      res = res.replace(/\b(c[\s\-]*(?:mass|moss|mos|fat|mose)|sea[\s\-]*moss)\b/gi, 'CMOS');
    }
    if (lowerKws.has('mosfet')) {
      res = res.replace(/\b(?:mos[\s\-]*fet|moss[\s\-]*fet|moss[\s\-]*fat)\b/gi, 'MOSFET');
    }
    if (lowerKws.has('vhdl')) {
      res = res.replace(/\bv[\s\.\-]*h[\s\.\-]*d[\s\.\-]*l\b/gi, 'VHDL');
    }

    return res;
  }

  /**
   * Start listening. Tries Deepgram first, falls back to webkitSpeechRecognition.
   * Keeps existing connection warm to prevent dropping initial words on unmute.
   */
  async startListening(username: string, sessionId: string, keywords: string[] = []): Promise<void> {
    this.lastUsername = username;
    this.lastSessionId = sessionId;
    if (keywords && keywords.length > 0) {
      this.currentKeywords = keywords;
    }
    this.shouldKeepListening = true;
    this.accumulatedTranscript = '';
    this.capitalizeNextChunk = true;

    // If Deepgram is already connected, resume immediately with ZERO delay
    if (this.currentEngine === 'deepgram' && this.dgWebSocket?.readyState === WebSocket.OPEN) {
      this.setMicActive(true);
      this.isListening = true;
      console.log('[SPEECH] Resumed listening on warm Deepgram connection');
      return;
    }

    if (this.isListening) return;

    // Try Deepgram first
    const deepgramOk = await this.startDeepgram(username, sessionId, this.currentKeywords);
    if (deepgramOk) {
      this.currentEngine = 'deepgram';
      this.engineSource.next('deepgram');
      this.isListening = true;
      return;
    }

    // Fallback to webkit
    console.warn('[SPEECH] Deepgram unavailable, falling back to webkitSpeechRecognition');
    const webkitOk = this.startWebkit();
    if (webkitOk) {
      this.currentEngine = 'webkit';
      this.engineSource.next('webkit');
      this.isListening = true;
      return;
    }

    console.error('[SPEECH] No STT engine available');
    this.currentEngine = 'none';
    this.engineSource.next('none');
  }

  stopListening(): string {
    this.isListening = false;

    if (this.currentEngine === 'deepgram') {
      // Keep socket open and warm with KeepAlive frames, only mute microphone
      this.setMicActive(false);
    } else if (this.currentEngine === 'webkit') {
      this.stopWebkit();
    }

    let final = this.accumulatedTranscript.trim();
    if (final && !/[.!?]$/.test(final)) {
      final = final + '.';
      this.accumulatedTranscript = final;
    }
    if (final) {
      this.finalTranscriptSource.next(final);
    }
    return final;
  }

  /**
   * FULL teardown — call when the exam ends / the user leaves the page.
   * stopListening() only mutes the mic and keeps the Deepgram socket warm for
   * the next question; shutdown() closes the STT socket, releases the
   * microphone and cancels any pending auto-reconnect. startListening() can
   * still be used afterwards (e.g. next exam) and will open a fresh connection.
   */
  shutdown(): void {
    this.shouldKeepListening = false;
    this.isListening = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnecting = false;

    // Forget the session so no stale reconnect can restart Deepgram
    this.lastUsername = '';
    this.lastSessionId = '';
    this.currentEngine = 'none';
    this.engineSource.next('none');

    this.stopWebkit();
    this.stopDeepgram();

    this.accumulatedTranscript = '';
    this.capitalizeNextChunk = true;
    console.log('[SPEECH] Shutdown complete — STT socket closed, microphone released');
  }

  clearTranscript(capitalizeNext = true): void {
    this.accumulatedTranscript = '';
    this.capitalizeNextChunk = capitalizeNext;
    this.transcriptSource.next('');
  }

  // Close the current sentence: guarantee terminal punctuation, and mark
  // that the next committed chunk should start with a capital letter.
  // Pure formatting — never adds/removes spoken words.
  private closeSentence(): void {
    const trimmed = this.accumulatedTranscript.trimEnd();
    this.accumulatedTranscript = /[.!?]$/.test(trimmed) ? trimmed : trimmed + '.';
    this.capitalizeNextChunk = true;
  }

  // ─── startDeepgram ──────────────────────────────────────────────
  private async startDeepgram(username: string, sessionId: string, keywords: string[] = []): Promise<boolean> {
    try {
      this.reconnecting = false;
      this.lastUsername = username;
      this.lastSessionId = sessionId;

      // 1. Get mic at 16kHz
      if (!this.dgStream || !this.dgStream.active) {
        this.dgStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: 16000,
          },
          video: false,
        });
      }

      // 2. AudioContext + ScriptProcessorNode (8192 buffer)
      if (!this.dgAudioContext || this.dgAudioContext.state === 'closed') {
        this.dgAudioContext = new AudioContext({ sampleRate: 16000 });
      }
      if (this.dgAudioContext.state === 'suspended') {
        await this.dgAudioContext.resume();
      }

      const source = this.dgAudioContext.createMediaStreamSource(this.dgStream);
      this.dgScriptNode = this.dgAudioContext.createScriptProcessor(2048, 1, 1);
      source.connect(this.dgScriptNode);

      // Connect to zero-gain destination to keep ScriptProcessor running without audio feedback
      this.dgGainNode = this.dgAudioContext.createGain();
      this.dgGainNode.gain.value = 0;
      this.dgScriptNode.connect(this.dgGainNode);
      this.dgGainNode.connect(this.dgAudioContext.destination);

      // 3. WebSocket to backend with query options
      const opts = environment.deepgramOptions || {};
      const params = new URLSearchParams();
      if (opts.model) params.set('model', opts.model);
      if (opts.endpointing) params.set('endpointing', opts.endpointing.toString());
      if (opts.utterance_end_ms) params.set('utterance_end_ms', opts.utterance_end_ms.toString());
      if (opts.punctuate !== undefined) params.set('punctuate', opts.punctuate ? 'true' : 'false');
      if (opts.smart_format !== undefined) params.set('smart_format', opts.smart_format ? 'true' : 'false');
      
      const allKeywords = this.deduplicateKeywords([...(opts.keywords || []), ...keywords]);
      if (allKeywords.length > 0) {
        allKeywords.slice(0, 100).forEach((k: string) => params.append('keywords', k));
        params.set('keyword_boost', (opts.keyword_boost ?? 6.0).toString());
      }
      console.log(`[DEEPGRAM STT] 🔑 Connecting with ${allKeywords.slice(0, 100).length} keywords:`, allKeywords.slice(0, 100));
      const qs = params.toString() ? `?${params.toString()}` : '';
      const baseWs = (environment.apiUrl || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/^http/, 'ws');
      const cleanUser = encodeURIComponent(username || 'candidate');
      const cleanSession = encodeURIComponent(sessionId || 'session_default');
      const wsUrl = `${baseWs}/ws/stt-stream/${cleanUser}/${cleanSession}${qs}`;

      this.dgWebSocket = new WebSocket(wsUrl);
      this.dgWebSocket.binaryType = 'arraybuffer';

      return new Promise<boolean>((resolve) => {
        let resolved = false;
        const fail = (reason: string) => {
          if (resolved) return;
          resolved = true;
          console.warn(`[SPEECH] Deepgram failed: ${reason}`);
          this.deepgramConnected = false;
          this.stopDeepgram();
          resolve(false);
        };

        this.dgWebSocket!.onopen = () => {
          console.log('[SPEECH] Deepgram WebSocket opened, initializing settings...');
          this.deepgramConnected = true;
          // if (!resolved) { resolved = true; resolve(true); }

          // Send settings handshake
          const settings = {
            type: 'Settings',
            model: opts.model ?? 'nova-2',
            tier: opts.tier ?? 'enhanced',
            smart_format: opts.smart_format ?? true,
            punctuate: opts.punctuate ?? false,
            keywords: allKeywords.slice(0, 100),
            keyword_boost: opts.keyword_boost ?? 6.0,
            endpointing: opts.endpointing ?? 150,
            utterance_end_ms: opts.utterance_end_ms ?? 800,
          };
          try {
            this.dgWebSocket!.send(JSON.stringify(settings));
            this.deepgramSettingsSent = true;
          } catch (e) {
            console.warn('[SPEECH] Failed to send settings:', e);
          }

          // Flush any pre-buffered audio
          this.flushAudioPreBuffer();

          // Keep-alive heartbeat: prevents Deepgram timeout during mic mute or pauses
          if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
          this.keepAliveInterval = setInterval(() => {
            if (this.dgWebSocket?.readyState === WebSocket.OPEN) {
              try {
                this.dgWebSocket.send(JSON.stringify({ type: 'KeepAlive' }));
              } catch {}
            }
          }, 3000);

          // Audio processing callback
          this.dgScriptNode!.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            if (this.micActive) {
              const pcm = this.floatTo16BitPCM(input);
              if (this.dgWebSocket?.readyState === WebSocket.OPEN) {
                try {
                  this.dgWebSocket.send(pcm);
                } catch (err) {
                  console.warn('[SPEECH] Send error:', err);
                }
              } else {
                // Buffer audio while socket is connecting so initial words are never lost
                if (this.audioPreBuffer.length > 12) {
                  this.audioPreBuffer.shift();
                }
                this.audioPreBuffer.push(pcm);
              }
            }
          };
        };

        this.dgWebSocket!.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'fallback') {
              fail(msg.reason || 'backend_fallback');
              return;
            }
            if (msg.type === 'connected') {
              console.log('[SPEECH] Received connected message from backend:', msg.model || opts.model);
              this.deepgramConnected = true;
              if (!resolved) { resolved = true; resolve(true); }
              return;
            }
            if (msg.type === 'utterance_end') {
              if (this.accumulatedTranscript) {
                this.closeSentence();
                this.transcriptSource.next(this.accumulatedTranscript.trim());
              }
              return;
            }
            if (msg.type === 'transcript') {
              if (msg.transcript && msg.transcript.trim()) {
                console.log(`[DEEPGRAM STT ➔ TRANSCRIPT] [${msg.speech_final ? 'SPEECH_FINAL' : (msg.is_final ? 'FINAL' : 'INTERIM')}] (conf: ${(msg.confidence || 0).toFixed(2)}): "${msg.transcript.trim()}"`);
              }
              if (msg.is_final) {
                let chunk = msg.transcript || '';
                if (chunk) {
                  chunk = this.normalizePhoneticDomainTerms(chunk, this.currentKeywords);
                  if (this.capitalizeNextChunk) {
                    chunk = chunk.charAt(0).toUpperCase() + chunk.slice(1);
                  }
                  this.accumulatedTranscript += (this.accumulatedTranscript ? ' ' : '') + chunk;
                }
                if (msg.speech_final && this.accumulatedTranscript) {
                  this.closeSentence();
                } else {
                  this.capitalizeNextChunk = false;
                }
                this.transcriptSource.next(this.accumulatedTranscript.trim());
              } else {
                const interimRaw = (this.accumulatedTranscript + ' ' + msg.transcript).trim();
                const interimNormalized = this.normalizePhoneticDomainTerms(interimRaw, this.currentKeywords);
                this.transcriptSource.next(interimNormalized);
              }
              if (typeof msg.confidence === 'number') {
                this.confidenceSource.next(msg.confidence);
              }
            }
            if (msg.type === 'multi_speaker_warning') {
              window.dispatchEvent(new CustomEvent('stt-multi-speaker', { detail: msg }));
            }
          } catch (err) {
            console.error('[SPEECH] Deepgram parse error:', err);
          }
        };

        this.dgWebSocket!.onerror = (e) => {
          console.error('[SPEECH] WebSocket error:', e);
          fail('websocket_error');
        };

        this.dgWebSocket!.onclose = (event) => {
          console.warn(`[SPEECH] WebSocket closed (code: ${event.code}, reason: ${event.reason})`);
          this.deepgramConnected = false;
          this.deepgramSettingsSent = false;
          if (this.currentEngine === 'deepgram' && !this.reconnecting) {
            this.reconnecting = true;
            this.stopDeepgram();
            console.warn('[SPEECH] Deepgram WS closed unexpectedly, reconnecting...');
            this.reconnectTimer = setTimeout(() => {
              this.reconnectTimer = null;
              this.reconnecting = false;
              if (this.lastUsername && this.lastSessionId) {
                this.startDeepgram(this.lastUsername, this.lastSessionId, this.currentKeywords);
              }
            }, 2000);
          }
        };

        setTimeout(() => { if (!resolved) fail('timeout'); }, 6000);
      });
    } catch (err) {
      console.error('[SPEECH] Deepgram setup error:', err);
      this.deepgramConnected = false;
      this.stopDeepgram();
      return false;
    }
  }

  private flushAudioPreBuffer(): void {
    if (!this.dgWebSocket || this.dgWebSocket.readyState !== WebSocket.OPEN) return;
    while (this.audioPreBuffer.length > 0) {
      const chunk = this.audioPreBuffer.shift();
      if (chunk) {
        try {
          this.dgWebSocket.send(chunk);
        } catch {}
      }
    }
  }

  // ─── Helper: Float32 → Int16 PCM (same as test.html) ────────────
  private floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }

  // ─── stopDeepgram ─────────────────────────────────────────────────
  stopDeepgram(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    this.deepgramConnected = false;
    this.deepgramSettingsSent = false;
    this.audioPreBuffer = [];

    if (this.dgScriptNode) {
      try {
        this.dgScriptNode.onaudioprocess = null;
        this.dgScriptNode.disconnect();
      } catch {}
      this.dgScriptNode = null;
    }
    if (this.dgGainNode) {
      try { this.dgGainNode.disconnect(); } catch {}
      this.dgGainNode = null;
    }
    if (this.dgAudioContext) {
      try { this.dgAudioContext.close(); } catch {}
      this.dgAudioContext = null;
    }
    if (this.dgStream) {
      this.dgStream.getTracks().forEach(t => t.stop());
      this.dgStream = null;
    }
    if (this.dgWebSocket) {
      try {
        this.dgWebSocket.onopen = null;
        this.dgWebSocket.onmessage = null;
        this.dgWebSocket.onerror = null;
        this.dgWebSocket.onclose = null;
        if (this.dgWebSocket.readyState === WebSocket.OPEN ||
            this.dgWebSocket.readyState === WebSocket.CONNECTING) this.dgWebSocket.close();
      } catch {}
      this.dgWebSocket = null;
    }
  }

  // ════════════════════════════════════════════════════════
  //  FALLBACK: webkitSpeechRecognition (existing behavior, kept intact)
  // ════════════════════════════════════════════════════════

  private startWebkit(): boolean {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return false;

    try {
      this.recognition = new SR();
    } catch {
      return false;
    }

    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-IN';
    this.recognition.maxAlternatives = 3;

    this.recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        let best = this.getBestAlternative(result);
        if (result.isFinal) {
          if (best) {
            // Capitalize the first letter of a new sentence — pure
            // formatting, same as the Deepgram path.
            if (this.capitalizeNextChunk) {
              best = best.charAt(0).toUpperCase() + best.slice(1);
            }
            this.accumulatedTranscript += (this.accumulatedTranscript ? ' ' : '') + best;
          }
          // WebKit's isFinal already represents a completed, pause-based
          // utterance (its own built-in segmentation) — but unlike Deepgram
          // it never adds punctuation itself. Treat every isFinal result as
          // a sentence boundary: guarantee terminal punctuation here.
          if (this.accumulatedTranscript) {
            this.closeSentence();
          }
          this.transcriptSource.next(this.accumulatedTranscript.trim());
        } else {
          interim += best;
          this.transcriptSource.next((this.accumulatedTranscript + ' ' + interim).trim());
        }
      }
      this.confidenceSource.next(0.7); // webkit doesn't expose reliable confidence
    };

    this.recognition.onerror = (event: any) => {
      console.warn('[SPEECH] webkit error:', event.error);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.shouldKeepListening = false;
      }
    };

    this.recognition.onend = () => {
      if (this.shouldKeepListening && this.currentEngine === 'webkit') {
        this.scheduleWebkitRestart();
      }
    };

    try {
      this.recognition.start();
      return true;
    } catch (err) {
      console.warn('[SPEECH] webkit start failed:', err);
      return false;
    }
  }

  private scheduleWebkitRestart(): void {
    if (this.restartTimeout) clearTimeout(this.restartTimeout);
    this.restartTimeout = setTimeout(() => {
      this.restartTimeout = null;
      if (this.shouldKeepListening && this.currentEngine === 'webkit' && this.recognition) {
        try {
          this.recognition.start();
        } catch (err) {
          console.warn('[SPEECH] webkit restart failed, retrying in 500ms:', err);
          // Retry with backoff (fixes the "single failure permanently disables" bug)
          this.restartTimeout = setTimeout(() => this.scheduleWebkitRestart(), 500);
        }
      }
    }, 300);
  }

  private stopWebkit(): void {
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    this.shouldKeepListening = false;
    if (this.recognition) {
      try { this.recognition.stop(); } catch {}
      try { this.recognition.onresult = null; this.recognition.onerror = null; this.recognition.onend = null; } catch {}
      this.recognition = null;
    }
  }

  private getBestAlternative(result: any): string {
    if (!result || !result.length) return '';
    let best = result[0];
    for (let i = 1; i < result.length; i++) {
      if (result[i].confidence > (best.confidence || 0)) best = result[i];
    }
    return best.transcript || '';
  }
}