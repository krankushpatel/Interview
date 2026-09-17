import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class RecordingService {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private isRecording = false;

  // FIX S4: Track ALL streams ever created so we can stop them all on cleanup
  private allTrackedStreams: MediaStream[] = [];

  constructor(private http: HttpClient) {}

  // Initialize camera and microphone
  async initCamera(): Promise<MediaStream> {
    // FIX S4: Stop ALL previously tracked streams before creating new one
    this.stopCamera();

    try {
      // Explicitly request high-quality audio properties
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      console.log('✅ Recording stream: video+audio');
      
      if (this.stream.getAudioTracks().length === 0) {
        console.warn('⚠️ Audio track was requested but not provided by the browser.');
      }
    } catch (err) {
      console.warn('video+audio failed, trying video only', err);
      // MISSING FALLBACK: Add this back so the app doesn't crash if mic is blocked!
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: true });
        console.log('⚠️ Video only (no audio)');
      } catch (err2) {
        console.warn('video failed, trying audio only', err2);
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('⚠️ Audio only');
      }
    }

    // FIX S4: Register this stream so we can always stop it later
    if (this.stream) {
      this.allTrackedStreams.push(this.stream);
    }

    return this.stream!;
  }

  // Start recording the exam session
  startRecording() {
    if (!this.stream || this.isRecording) return;
    this.chunks = [];
    const mime = this.getSupportedMime();
    this.recorder = mime
      ? new MediaRecorder(this.stream, { mimeType: mime })
      : new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.recorder.start(500);
    this.isRecording = true;
    console.log('[Recording] Started');
  }

  async stopAndUpload(username: string, durationSec: number = 0, sessionId: string): Promise<void> {
    if (!this.recorder || !this.isRecording) {
      this.stopCamera();
      return;
    }

    // ✅ FIX: Stop ALL camera/mic tracks IMMEDIATELY (before the recorder even stops).
    // The MediaRecorder can still finalize its blob from buffered data — it does NOT
    // need live tracks to produce the output. This releases the hardware light within
    // milliseconds, instead of waiting for upload (which can take 10-30 seconds).
    const tracksToStop = this.allTrackedStreams.flatMap(s => s.getTracks());
    tracksToStop.forEach(track => {
      try { track.enabled = false; track.stop(); } catch (e) {}
    });
    console.log(`[Recording] Pre-stopped ${tracksToStop.length} tracks (hardware released)`);

    return new Promise((resolve) => {
      this.recorder!.onstop = async () => {
        const blob = new Blob(this.chunks, { type: this.getSupportedMime() || 'video/webm' });
        const fd = new FormData();
        fd.append('username', username);
        fd.append('duration', durationSec.toString());
        fd.append('session_id', sessionId);
        fd.append('video', blob, `exam_${username}.webm`);
        try {
          await lastValueFrom(this.http.post(`${environment.apiUrl}/recording/submit/exam-recording`, fd));
          console.log('[Recording] Uploaded successfully');
        } catch (err) {
          console.error('[Recording] Upload failed', err);
        }

        // Final cleanup of stream references (tracks already stopped above)
        this.stopCamera();
        resolve();
      };

      try {
        this.recorder!.stop();
      } catch (e) {
        console.warn('[Recording] Recorder stop error', e);
        this.stopCamera();
        resolve();
      }
      this.isRecording = false;
    });
  }

  stopCamera() {
    console.log(`[Recording] Nuclear stop sequence initiated`);

    // 1. Pehle main stream ke tracks stop karein
    if (this.stream) {
      this.stream.getTracks().forEach(track => {
        track.enabled = false; // Pehle mute karein
        track.stop();         // Phir release karein
      });
      this.stream = null;
    }

    // 2. Phir saari tracked streams (clones, fallbacks) ko kill karein
    if (this.allTrackedStreams && this.allTrackedStreams.length > 0) {
      this.allTrackedStreams.forEach(s => {
        if (s) {
          s.getTracks().forEach(track => {
            track.enabled = false;
            track.stop();
          });
        }
      });
    }
    this.allTrackedStreams = [];

    // 3. Recorder ko clean karein
    if (this.recorder && this.isRecording) {
      try { this.recorder.stop(); } catch (e) {}
      this.recorder = null;
      this.isRecording = false;
    }
    
    this.chunks = [];
    console.log('[Recording] Hardware indicators should be OFF now');
  }

  // FIX S4: Nuclear option — enumerate and stop ALL media tracks in the browser
  async stopAllBrowserTracks(): Promise<void> {
    try {
      // We request a new stream just to get the device list, then immediately stop everything.
      // This forces the browser to release the hardware indicator (green dot).
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasCamera = devices.some(d => d.kind === 'videoinput');
      if (hasCamera) {
        // Small trick: attach a temporary stream and kill it immediately
        const tmp = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null);
        if (tmp) tmp.getTracks().forEach(t => t.stop());
      }
    } catch (e) {
      // Ignore — just best-effort
    }
  }

  initWithStream(externalStream: MediaStream) {
    this.stopCamera(); // Clean up old tracks
    this.stream = externalStream;
    
    if (this.stream) {
      this.allTrackedStreams.push(this.stream); // Register for cleanup
    }
    console.log('✅ Recorder initialized with cloned stream');
  }

  private getSupportedMime(): string {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  }

  get recordingActive(): boolean {
    return this.isRecording;
  }

  getCurrentStream(): MediaStream | null {
    return this.stream;
  }
}