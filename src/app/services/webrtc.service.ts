import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';

export interface WebRtcStreamEvent {
  stream: MediaStream;
  type: 'camera' | 'screen' | 'unknown';
}

@Injectable({
  providedIn: 'root'
})
export class WebRtcService {
  private pc: RTCPeerConnection | null = null;
  private ws: WebSocket | null = null;
  private currentUsername: string = '';
  private currentRole: 'student' | 'admin' | null = null;

  // Connection State
  public connectionState$ = new BehaviorSubject<string>('disconnected');
  public peerOnline$ = new BehaviorSubject<boolean>(false);
  public isWebRtcStreaming$ = new BehaviorSubject<boolean>(false);

  // Streams for Admin
  public cameraStream$ = new BehaviorSubject<MediaStream | null>(null);
  public screenStream$ = new BehaviorSubject<MediaStream | null>(null);

  // Saved local streams on student
  private savedCameraStream: MediaStream | null = null;
  private savedScreenStream: MediaStream | null = null;

  // Stream IDs exchanged in signaling to differentiate camera vs screen
  private expectedCameraStreamId: string | null = null;
  private expectedScreenStreamId: string | null = null;

  // Intercom & 2-Way Audio
  private adminMicStream: MediaStream | null = null;
  private studentAudioEl: HTMLAudioElement | null = null;
  public isAdminTalking$ = new BehaviorSubject<boolean>(false);

  // Stored local senders for track replacement
  private localSenders: Map<string, RTCRtpSender> = new Map();
  private pendingIceCandidates: RTCIceCandidateInit[] = [];

  // Standard ICE Servers configuration
  private rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 4
  };

  constructor() {}

  // ==========================================
  // 1. STUDENT INITIATION
  // ==========================================
  public startStudent(username: string, cameraStream?: MediaStream, screenStream?: MediaStream) {
    this.currentUsername = username;
    this.currentRole = 'student';

    if (cameraStream) this.savedCameraStream = cameraStream;
    if (screenStream) this.savedScreenStream = screenStream;

    this.setupSignalingSocket('student', username);
    this.createPeerConnection();

    if (this.savedCameraStream) this.attachStream(this.savedCameraStream, 'camera');
    if (this.savedScreenStream) this.attachStream(this.savedScreenStream, 'screen');
  }

  // ==========================================
  // 2. ADMIN INITIATION
  // ==========================================
  public async startAdmin(username: string) {
    this.currentUsername = username;
    this.currentRole = 'admin';
    this.cameraStream$.next(null);
    this.screenStream$.next(null);
    this.isAdminTalking$.next(false);
    this.isWebRtcStreaming$.next(false);

    // Prepare Admin Intercom Mic early
    await this.initAdminIntercom();

    this.setupSignalingSocket('admin', username);
    this.createPeerConnection();
  }

  // ==========================================
  // 3. ADMIN INTERCOM CONTROLS
  // ==========================================
  public async initAdminIntercom(): Promise<boolean> {
    try {
      if (!this.adminMicStream) {
        this.adminMicStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        // Start muted by default so admin is silent observer initially
        this.adminMicStream.getAudioTracks().forEach(t => t.enabled = false);
      }
      return true;
    } catch (err) {
      console.warn('[WebRTC Intercom] Admin mic not available:', err);
      return false;
    }
  }

  public async setAdminMicEnabled(enabled: boolean): Promise<void> {
    if (!this.adminMicStream && enabled) {
      const ok = await this.initAdminIntercom();
      if (!ok) return;
    }

    if (this.adminMicStream) {
      this.adminMicStream.getAudioTracks().forEach(t => t.enabled = enabled);
    }
    this.isAdminTalking$.next(enabled);

    // If track was not added yet to PC, add it and request renegotiation
    if (this.pc && this.adminMicStream && !this.localSenders.has('admin_mic')) {
      const audioTrack = this.adminMicStream.getAudioTracks()[0];
      if (audioTrack) {
        const sender = this.pc.addTrack(audioTrack, this.adminMicStream);
        this.localSenders.set('admin_mic', sender);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'request-offer' }));
        }
      }
    }
  }

  // ==========================================
  // 4. ATTACH / UPDATE LOCAL TRACKS (Student)
  // ==========================================
  public attachStream(stream: MediaStream, type: 'camera' | 'screen') {
    if (type === 'camera') this.savedCameraStream = stream;
    if (type === 'screen') this.savedScreenStream = stream;

    if (!this.pc) return;

    stream.getTracks().forEach(track => {
      const key = `${type}_${track.kind}`;
      const existingSender = this.localSenders.get(key);

      if (existingSender) {
        existingSender.replaceTrack(track).catch(err => {
          console.warn(`[WebRTC] Failed to replace track ${key}:`, err);
        });
      } else {
        try {
          const sender = this.pc!.addTrack(track, stream);
          this.localSenders.set(key, sender);
        } catch (e) {
          console.warn(`[WebRTC] Error adding track ${key}:`, e);
        }
      }
    });

    // If admin is currently online, renegotiate
    if (this.currentRole === 'student' && this.peerOnline$.value && this.ws?.readyState === WebSocket.OPEN) {
      this.renegotiateAsStudent();
    }
  }

  // ==========================================
  // 5. PEER CONNECTION CREATION
  // ==========================================
  private createPeerConnection() {
    if (this.pc) {
      try { this.pc.close(); } catch (e) {}
      this.pc = null;
    }

    this.localSenders.clear();
    this.pendingIceCandidates = [];
    this.pc = new RTCPeerConnection(this.rtcConfig);
    this.connectionState$.next('new');

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState || 'disconnected';
      console.log(`[WebRTC] Connection state: ${state}`);
      this.connectionState$.next(state);
      const isConnected = state === 'connected';
      this.isWebRtcStreaming$.next(isConnected);
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: event.candidate
        }));
      }
    };

    this.pc.ontrack = (event) => {
      console.log('[WebRTC] Received remote track:', event.track.kind, 'stream id:', event.streams[0]?.id);

      // Student receives Admin voice
      if (this.currentRole === 'student') {
        if (event.track.kind === 'audio') {
          console.log('[WebRTC Student] Receiving Admin audio track');
          this.playIncomingAdminAudio(event.streams[0] || new MediaStream([event.track]));
        }
        return;
      }

      // Admin receives Student camera, audio, or screen
      if (event.track.kind === 'audio') {
        if (this.cameraStream$.value) {
          const currentCam = this.cameraStream$.value;
          if (!currentCam.getAudioTracks().includes(event.track)) {
            currentCam.addTrack(event.track);
          }
        } else {
          this.cameraStream$.next(new MediaStream([event.track]));
        }
        return; // Audio track must never be assigned to screen stream
      }

      // Video tracks routing (Camera vs Screen)
      const incomingStream = event.streams[0] || new MediaStream([event.track]);

      if (this.expectedScreenStreamId && incomingStream.id === this.expectedScreenStreamId) {
        console.log('[WebRTC Admin] Assigned to Screen Stream (Matched ID)');
        this.screenStream$.next(incomingStream);
      } else if (this.expectedCameraStreamId && incomingStream.id === this.expectedCameraStreamId) {
        console.log('[WebRTC Admin] Assigned to Camera Stream (Matched ID)');
        this.cameraStream$.next(incomingStream);
      } else {
        // Fallback heuristic if IDs not provided or dynamically generated
        const isScreenLabel = event.track.label && (event.track.label.toLowerCase().includes('screen') || event.track.label.toLowerCase().includes('window') || event.track.label.toLowerCase().includes('display'));
        if (isScreenLabel) {
          console.log('[WebRTC Admin] Assigned to Screen Stream (Label heuristic)');
          this.screenStream$.next(incomingStream);
        } else if (!this.cameraStream$.value || this.cameraStream$.value.getVideoTracks().length === 0) {
          console.log('[WebRTC Admin] Assigned to Camera Stream (First Video)');
          this.cameraStream$.next(incomingStream);
        } else if (!this.screenStream$.value) {
          console.log('[WebRTC Admin] Assigned to Screen Stream (Second Video)');
          this.screenStream$.next(incomingStream);
        } else {
          console.log('[WebRTC Admin] Updating Camera Stream');
          this.cameraStream$.next(incomingStream);
        }
      }
    };
  }

  // ==========================================
  // 6. STUDENT PLAYS ADMIN INCOMING VOICE
  // ==========================================
  private playIncomingAdminAudio(stream: MediaStream) {
    try {
      if (!this.studentAudioEl) {
        this.studentAudioEl = new Audio();
        this.studentAudioEl.autoplay = true;
        (this.studentAudioEl as any).playsInline = true;
        this.studentAudioEl.style.display = 'none';
        document.body.appendChild(this.studentAudioEl);
      }
      this.studentAudioEl.srcObject = stream;
      const playPromise = this.studentAudioEl.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          console.warn('[WebRTC Student Audio] Autoplay wait:', err);
          const resumeAudio = () => {
            this.studentAudioEl?.play().catch(() => {});
            document.removeEventListener('click', resumeAudio);
            document.removeEventListener('keydown', resumeAudio);
          };
          document.addEventListener('click', resumeAudio, { once: true });
          document.addEventListener('keydown', resumeAudio, { once: true });
        });
      }
    } catch (e) {
      console.warn('[WebRTC Student Audio] Audio element error:', e);
    }
  }

  // ==========================================
  // 7. SETUP SIGNALING WEBSOCKET
  // ==========================================
  private setupSignalingSocket(role: 'student' | 'admin', username: string) {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }

    const baseWs = this.getWebSocketBaseUrl();
    const url = `${baseWs}/ws/webrtc/${role}/${encodeURIComponent(username)}`;
    console.log(`[WebRTC Signaling] Connecting to: ${url}`);

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log(`[WebRTC Signaling] Connected as ${role}`);
      if (role === 'admin') {
        this.ws?.send(JSON.stringify({ type: 'request-offer' }));
      }
    };

    this.ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await this.handleSignalingMessage(msg);
      } catch (err) {
        console.warn('[WebRTC Signaling] Invalid message received:', err);
      }
    };

    this.ws.onerror = (err) => {
      console.warn('[WebRTC Signaling] Socket error:', err);
      this.connectionState$.next('error');
    };

    this.ws.onclose = () => {
      console.log('[WebRTC Signaling] Socket closed');
      this.peerOnline$.next(false);
      this.isWebRtcStreaming$.next(false);
    };
  }

  // ==========================================
  // 8. SIGNALING MESSAGE HANDLER
  // ==========================================
  private async handleSignalingMessage(msg: any) {
    switch (msg.type) {
      case 'admin-joined':
        console.log('[WebRTC] Admin joined, renegotiating fresh P2P stream...');
        this.peerOnline$.next(true);
        if (this.currentRole === 'student') {
          await this.renegotiateAsStudent();
        }
        break;

      case 'admin-left':
        console.log('[WebRTC] Admin disconnected');
        this.peerOnline$.next(false);
        this.isWebRtcStreaming$.next(false);
        break;

      case 'peer-status':
        this.peerOnline$.next(msg.status === 'online');
        if (msg.status === 'online') {
          if (this.currentRole === 'student') {
            await this.renegotiateAsStudent();
          } else if (this.currentRole === 'admin') {
            this.ws?.send(JSON.stringify({ type: 'request-offer' }));
          }
        }
        break;

      case 'request-offer':
        if (this.currentRole === 'student') {
          await this.renegotiateAsStudent();
        }
        break;

      case 'offer':
        if (this.currentRole === 'admin') {
          console.log('[WebRTC] Received offer from student, preparing answer');
          this.expectedCameraStreamId = msg.cameraStreamId || null;
          this.expectedScreenStreamId = msg.screenStreamId || null;

          if (!this.pc || this.pc.signalingState !== 'stable') {
            this.createPeerConnection();
          }

          if (this.adminMicStream) {
            const audioTrack = this.adminMicStream.getAudioTracks()[0];
            if (audioTrack && !this.localSenders.has('admin_mic')) {
              const sender = this.pc!.addTrack(audioTrack, this.adminMicStream);
              this.localSenders.set('admin_mic', sender);
            }
          }

          await this.pc!.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          await this.flushPendingIceCandidates();

          const answer = await this.pc!.createAnswer();
          await this.pc!.setLocalDescription(answer);

          this.ws?.send(JSON.stringify({
            type: 'answer',
            sdp: answer
          }));
        }
        break;

      case 'answer':
        if (this.currentRole === 'student' && this.pc) {
          console.log('[WebRTC] Received answer, setting remote description');
          await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          await this.flushPendingIceCandidates();
        }
        break;

      case 'ice-candidate':
        if (msg.candidate && this.pc) {
          if (this.pc.remoteDescription && this.pc.remoteDescription.type) {
            try {
              await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch (e) {
              console.warn('[WebRTC] Error adding ICE candidate:', e);
            }
          } else {
            this.pendingIceCandidates.push(msg.candidate);
          }
        }
        break;
    }
  }

  // ==========================================
  // 9. RENEGOTIATE AS STUDENT (Fresh Offer)
  // ==========================================
  private async renegotiateAsStudent() {
    if (this.currentRole !== 'student') return;

    try {
      // Re-initialize clean peer connection to prevent stuck state
      this.createPeerConnection();

      // Attach saved camera tracks
      if (this.savedCameraStream) {
        this.savedCameraStream.getTracks().forEach(t => {
          try {
            const sender = this.pc!.addTrack(t, this.savedCameraStream!);
            this.localSenders.set(`camera_${t.kind}`, sender);
          } catch (e) {}
        });
      }

      // Attach saved screen tracks
      if (this.savedScreenStream) {
        this.savedScreenStream.getTracks().forEach(t => {
          try {
            const sender = this.pc!.addTrack(t, this.savedScreenStream!);
            this.localSenders.set(`screen_${t.kind}`, sender);
          } catch (e) {}
        });
      }

      await this.initiateOffer();
    } catch (err) {
      console.error('[WebRTC] Error during student renegotiation:', err);
    }
  }

  // ==========================================
  // 10. INITIATE SDP OFFER (Student)
  // ==========================================
  private async initiateOffer() {
    if (!this.pc || this.currentRole !== 'student') return;
    try {
      const offer = await this.pc.createOffer({
        offerToReceiveAudio: true, // Receive Admin voice
        offerToReceiveVideo: false
      });
      await this.pc.setLocalDescription(offer);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'offer',
          sdp: offer,
          cameraStreamId: this.savedCameraStream?.id,
          screenStreamId: this.savedScreenStream?.id
        }));
        console.log('[WebRTC] Sent fresh 30fps offer to Admin');
      }
    } catch (err) {
      console.error('[WebRTC] Error creating offer:', err);
    }
  }

  private async flushPendingIceCandidates() {
    if (!this.pc) return;
    while (this.pendingIceCandidates.length > 0) {
      const cand = this.pendingIceCandidates.shift();
      if (cand) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn('[WebRTC] Error flushing ICE candidate:', e);
        }
      }
    }
  }

  // ==========================================
  // 11. TEARDOWN & CLEANUP
  // ==========================================
  public disconnect() {
    console.log('[WebRTC] Disconnecting and cleaning up resources');
    this.localSenders.clear();
    this.pendingIceCandidates = [];

    if (this.adminMicStream) {
      this.adminMicStream.getTracks().forEach(t => t.stop());
      this.adminMicStream = null;
    }
    if (this.studentAudioEl) {
      this.studentAudioEl.pause();
      this.studentAudioEl.srcObject = null;
    }

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }

    if (this.pc) {
      try { this.pc.close(); } catch (e) {}
      this.pc = null;
    }

    this.connectionState$.next('disconnected');
    this.peerOnline$.next(false);
    this.isWebRtcStreaming$.next(false);
    this.cameraStream$.next(null);
    this.screenStream$.next(null);
    this.isAdminTalking$.next(false);
  }

  private getWebSocketBaseUrl(): string {
    if ((environment as any).wsUrl) {
      return (environment as any).wsUrl;
    }
    const loc = window.location;
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${loc.host}`;
  }
}
