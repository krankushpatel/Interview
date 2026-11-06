import { Component, Input, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';

import { CommonModule } from '@angular/common';

import { IonicModule, ModalController } from '@ionic/angular';

import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

import { Subscription } from 'rxjs';

import { environment } from '../../../environments/environment';

import { WebRtcService } from '../../services/webrtc.service';



@Component({

  selector: 'app-live-view-modal',

  standalone: true,

  imports: [CommonModule, IonicModule],

  schemas: [CUSTOM_ELEMENTS_SCHEMA],

  template: `

    <ion-header>

      <ion-toolbar>

        <ion-title>🔴 Live Proctoring & Intercom: {{ username }}</ion-title>

        <ion-buttons slot="end">

          <ion-button (click)="close()">Close</ion-button>

        </ion-buttons>

      </ion-toolbar>

    </ion-header>

    <ion-content class="ion-padding" style="background: #0a0a0a;">

      <div class="live-grid">

        <!-- Camera Feed -->

        <div class="live-card">

          <div class="live-label">

            <span>📹 LIVE CAMERA</span>

            <span class="stream-protocol-tag" [class.webrtc-tag]="hasWebRtcCamera">

              {{ hasWebRtcCamera ? '⚡ WebRTC 30fps' : (cameraFrame ? '📷 WebSocket' : '⏳ Connecting...') }}

            </span>

          </div>

          <div class="live-frame">

            <!-- WebRTC 30fps Video Stream (Audio unmuted when listenAudio is true) -->

            <video #cameraVideo id="admin-camera-video" autoplay playsinline [muted]="!listenAudio" class="live-video" [style.display]="hasWebRtcCamera ? 'block' : 'none'"></video>

            

            <!-- WebSocket Fallback Snapshot -->

            <img *ngIf="!hasWebRtcCamera && cameraFrame" [src]="cameraFrame" class="live-image" />

            

            <!-- Loading Indicator -->

            <div *ngIf="!hasWebRtcCamera && !cameraFrame" class="loading">

              <ion-spinner name="crescent"></ion-spinner>

              <p>Waiting for camera stream...</p>

            </div>

          </div>

        </div>

        

        <!-- Screen Feed -->
        <div class="live-card">
          <div class="live-label">
            <span>🖥️ LIVE SCREEN</span>
            <span class="stream-protocol-tag" [class.webrtc-tag]="hasWebRtcScreen">
              {{ hasWebRtcScreen ? '⚡ WebRTC Live' : (screenFrame ? '📷 WebSocket' : (isScreenUnavailable ? '📱 Camera Only' : '⏳ Connecting...')) }}
            </span>
          </div>
          <div class="live-frame">
            <!-- WebRTC Live Screen Stream -->
            <video #screenVideo id="admin-screen-video" autoplay playsinline [muted]="true" class="live-video" [style.display]="hasWebRtcScreen ? 'block' : 'none'"></video>

            <!-- WebSocket Fallback Snapshot -->
            <img *ngIf="!hasWebRtcScreen && screenFrame" [src]="screenFrame" class="live-image" />

            <!-- Loading Indicator -->
            <div *ngIf="!hasWebRtcScreen && !screenFrame && !isScreenUnavailable" class="loading">
              <ion-spinner name="crescent"></ion-spinner>
              <p>Waiting for screen stream...</p>
            </div>

            <!-- Screen Unavailable (Mobile or Camera-Only Device) -->
            <div *ngIf="!hasWebRtcScreen && !screenFrame && isScreenUnavailable" class="loading" style="color: #9ca3af; text-align: center; padding: 1.5rem;">
              <span style="font-size: 2.2rem; display: block; margin-bottom: 0.5rem;">📱</span>
              <p style="font-weight: 600; color: #f3f4f6; margin: 0 0 0.25rem 0; font-size: 0.95rem;">Mobile / Camera-Only Device</p>
              <p style="font-size: 0.78rem; color: #9ca3af; margin: 0;">Screen sharing is not active on candidate's device</p>
            </div>
          </div>
        </div>

      </div>



      <!-- ══════════════════════════════════════════

           2-WAY INTERCOM & PROCTORING CONTROLS

      ══════════════════════════════════════════ -->

      <div class="intercom-toolbar">

        <div class="intercom-status-box">

          <span class="status-dot" [class.live-dot]="isTalking" [class.listen-dot]="!isTalking && listenAudio"></span>

          <span class="status-msg">

            {{ isTalking ? '🔴 Live Speaking to Student...' : (listenAudio ? '🔊 Listening to Candidate Room' : '🔇 Student Audio Muted') }}

          </span>

        </div>



        <div class="intercom-btn-group">

          <!-- Toggle Listen Candidate Audio -->

          <button type="button" class="intercom-action-btn listen-btn" [class.active]="listenAudio" (click)="toggleListenAudio()">

            <span>{{ listenAudio ? '🔊 Mute Student' : '🔈 Listen to Student' }}</span>

          </button>



          <!-- Toggle Talk to Student (Intercom) -->

          <button type="button" class="intercom-action-btn talk-btn" [class.talking]="isTalking" (click)="toggleTalk()">

            <span class="btn-icon">{{ isTalking ? '🛑' : '🎙️' }}</span>

            <span>{{ isTalking ? 'Stop Talking' : 'Talk to Student' }}</span>

          </button>

        </div>

      </div>

      

      <div class="live-info">

        <div class="info-badge">

          <span class="dot active"></span>

          <span>{{ (hasWebRtcCamera || hasWebRtcScreen) ? 'WebRTC Real-time P2P Active' : 'Fallback Streaming Active' }}</span>

        </div>

        <div class="info-text">

          Status: {{ connectionStatus }} | Last update: {{ lastUpdate | date:'hh:mm:ss' }}

        </div>

      </div>

    </ion-content>

  `,

  styles: [`

    .live-grid {

      display: grid;

      grid-template-columns: 1fr 1fr;

      gap: 1rem;

      height: calc(100% - 150px);

      min-height: 280px;

    }

    

    .live-card {

      background: #111;

      border-radius: 12px;

      overflow: hidden;

      display: flex;

      flex-direction: column;

      border: 1px solid rgba(255, 255, 255, 0.08);

    }

    

    .live-label {

      padding: 0.75rem;

      background: rgba(0,0,0,0.7);

      color: #fff;

      font-weight: 600;

      font-size: 0.85rem;

      display: flex;

      justify-content: space-between;

      align-items: center;

    }



    .stream-protocol-tag {

      font-size: 0.7rem;

      padding: 2px 8px;

      border-radius: 12px;

      background: rgba(255, 255, 255, 0.15);

      color: #ccc;

      font-weight: 500;

    }



    .stream-protocol-tag.webrtc-tag {

      background: rgba(0, 229, 160, 0.2);

      color: #00e5a0;

      border: 1px solid rgba(0, 229, 160, 0.4);

    }

    

    .live-frame {

      flex: 1;

      display: flex;

      align-items: center;

      justify-content: center;

      background: #161616;

      min-height: 220px;

      position: relative;

    }

    

    .live-image, .live-video {

      max-width: 100%;

      max-height: 100%;

      width: 100%;

      height: 100%;

      object-fit: contain;

    }

    

    .loading {

      text-align: center;

      color: #666;

    }



    /* Intercom Toolbar */

    .intercom-toolbar {

      margin-top: 1rem;

      padding: 0.85rem 1.25rem;

      background: #18181b;

      border-radius: 12px;

      border: 1px solid rgba(255, 255, 255, 0.1);

      display: flex;

      justify-content: space-between;

      align-items: center;

      gap: 1rem;

      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);

    }



    .intercom-status-box {

      display: flex;

      align-items: center;

      gap: 0.6rem;

    }



    .status-dot {

      width: 10px;

      height: 10px;

      border-radius: 50%;

      background: #71717a;

    }



    .status-dot.listen-dot {

      background: #22c55e;

      box-shadow: 0 0 8px rgba(34, 197, 94, 0.6);

    }



    .status-dot.live-dot {

      background: #ef4444;

      box-shadow: 0 0 12px rgba(239, 68, 68, 0.9);

      animation: pulseTalking 1s infinite;

    }



    .status-msg {

      color: #e4e4e7;

      font-size: 0.88rem;

      font-weight: 600;

    }



    .intercom-btn-group {

      display: flex;

      align-items: center;

      gap: 0.75rem;

    }



    .intercom-action-btn {

      padding: 8px 18px;

      border-radius: 8px;

      font-size: 0.85rem;

      font-weight: 600;

      cursor: pointer;

      border: 1px solid transparent;

      display: inline-flex;

      align-items: center;

      gap: 6px;

      transition: all 0.2s ease;

    }



    .listen-btn {

      background: rgba(255, 255, 255, 0.1);

      color: #d4d4d8;

      border-color: rgba(255, 255, 255, 0.15);



      &:hover {

        background: rgba(255, 255, 255, 0.18);

        color: #ffffff;

      }



      &.active {

        background: rgba(34, 197, 94, 0.15);

        color: #4ade80;

        border-color: rgba(34, 197, 94, 0.35);

      }

    }



    .talk-btn {

      background: #2563eb;

      color: #ffffff;

      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.4);



      &:hover {

        background: #1d4ed8;

      }



      &.talking {

        background: #dc2626;

        box-shadow: 0 0 14px rgba(220, 38, 38, 0.6);

        animation: pulseButton 1.5s infinite;

      }

    }



    @keyframes pulseTalking {

      0%, 100% { transform: scale(1); opacity: 1; }

      50% { transform: scale(1.3); opacity: 0.6; }

    }



    @keyframes pulseButton {

      0%, 100% { box-shadow: 0 0 8px rgba(220, 38, 38, 0.4); }

      50% { box-shadow: 0 0 18px rgba(220, 38, 38, 0.85); }

    }

    

    .live-info {

      margin-top: 0.75rem;

      padding: 0.6rem 0.75rem;

      background: rgba(255,255,255,0.06);

      border-radius: 8px;

      display: flex;

      justify-content: space-between;

      align-items: center;

    }

    

    .info-badge {

      display: flex;

      align-items: center;

      gap: 0.5rem;

      color: #00e5a0;

      font-size: 0.8rem;

    }

    

    .dot {

      width: 8px;

      height: 8px;

      border-radius: 50%;

      background: #00e5a0;

      animation: pulse 1.5s infinite;

    }

    

    .info-text {

      color: #888;

      font-size: 0.75rem;

    }

    

    @keyframes pulse {

      0%, 100% { opacity: 1; }

      50% { opacity: 0.3; }

    }

    

    @media (max-width: 768px) {

      .live-grid {

        grid-template-columns: 1fr;

        height: auto;

        gap: 1rem;

      }

      .intercom-toolbar {

        flex-direction: column;

        align-items: stretch;

      }

      .intercom-btn-group {

        justify-content: space-between;

      }

    }

  `]

})

export class LiveViewModalComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() username!: string;

  @ViewChild('cameraVideo') cameraVideoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('screenVideo') screenVideoRef!: ElementRef<HTMLVideoElement>;

  cameraFrame: string | null = null;
  screenFrame: string | null = null;
  hasWebRtcCamera: boolean = false;
  hasWebRtcScreen: boolean = false;
  isScreenUnavailable: boolean = false;
  connectionStatus: string = 'Initializing';
  lastUpdate: Date = new Date();

  // Intercom state
  listenAudio: boolean = true;
  isTalking: boolean = false;

  private latestCameraStream: MediaStream | null = null;
  private latestScreenStream: MediaStream | null = null;
  private screenWs: WebSocket | null = null;
  private cameraWs: WebSocket | null = null;
  private screenTimeout: any = null;
  private subs: Subscription[] = [];

  constructor(
    private modalCtrl: ModalController,
    private webrtcService: WebRtcService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.startWebRtcView();
    this.startWebSocketFallbackView();
  }

  ngAfterViewInit() {
    this.attachStreamsIfReady();
  }

  private attachStreamsIfReady() {
    if (this.latestCameraStream) {
      this.bindVideoElement(this.cameraVideoRef?.nativeElement, this.latestCameraStream, !this.listenAudio);
    }
    if (this.latestScreenStream) {
      this.bindVideoElement(this.screenVideoRef?.nativeElement, this.latestScreenStream, true);
    }
  }

  private bindVideoElement(videoEl: HTMLVideoElement | undefined, stream: MediaStream, muted: boolean) {
    if (!videoEl) return;
    try {
      videoEl.muted = muted;
      if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
      }
      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          setTimeout(() => {
            if (videoEl && videoEl.srcObject) {
              videoEl.muted = true;
              videoEl.play().catch(() => {});
            }
          }, 250);
        });
      }
    } catch (e) {
      console.warn('[LiveModal] Error binding video element:', e);
    }
  }

  // 1. WebRTC Ultra Low-Latency Stream & 2-Way Audio
  private startWebRtcView() {
    this.webrtcService.startAdmin(this.username);

    // Watch for incoming WebRTC camera stream
    const camSub = this.webrtcService.cameraStream$.subscribe(stream => {
      this.latestCameraStream = stream;
      if (stream && stream.getVideoTracks().length > 0) {
        this.hasWebRtcCamera = true;
        this.lastUpdate = new Date();
        this.cdr.detectChanges();
        this.bindVideoElement(this.cameraVideoRef?.nativeElement, stream, !this.listenAudio);
        setTimeout(() => this.bindVideoElement(this.cameraVideoRef?.nativeElement, stream, !this.listenAudio), 150);
        setTimeout(() => this.bindVideoElement(this.cameraVideoRef?.nativeElement, stream, !this.listenAudio), 500);
      } else {
        this.hasWebRtcCamera = false;
      }
    });
    this.subs.push(camSub);

    // Watch for incoming WebRTC screen stream
    const screenSub = this.webrtcService.screenStream$.subscribe(stream => {
      this.latestScreenStream = stream;
      if (stream && stream.getVideoTracks().length > 0) {
        this.hasWebRtcScreen = true;
        this.isScreenUnavailable = false;
        this.lastUpdate = new Date();
        this.cdr.detectChanges();
        this.bindVideoElement(this.screenVideoRef?.nativeElement, stream, true);
        setTimeout(() => this.bindVideoElement(this.screenVideoRef?.nativeElement, stream, true), 150);
        setTimeout(() => this.bindVideoElement(this.screenVideoRef?.nativeElement, stream, true), 500);
      } else {
        this.hasWebRtcScreen = false;
      }
    });
    this.subs.push(screenSub);

    // If candidate device does not send screen stream within 5s, mark as Camera-Only mode
    this.screenTimeout = setTimeout(() => {
      if (!this.hasWebRtcScreen && !this.screenFrame) {
        this.isScreenUnavailable = true;
        this.cdr.detectChanges();
      }
    }, 5000);

    // Watch Admin talking state
    const talkSub = this.webrtcService.isAdminTalking$.subscribe(talking => {
      this.isTalking = talking;
      this.cdr.detectChanges();
    });
    this.subs.push(talkSub);

    // Watch connection state
    const stateSub = this.webrtcService.connectionState$.subscribe(state => {
      this.connectionStatus = state;
      this.cdr.detectChanges();
    });
    this.subs.push(stateSub);
  }

  // Toggle listening to student
  toggleListenAudio() {
    this.listenAudio = !this.listenAudio;
    if (this.cameraVideoRef?.nativeElement) {
      this.cameraVideoRef.nativeElement.muted = !this.listenAudio;
    }
  }

  // Toggle Admin talking (Intercom)
  async toggleTalk() {
    const nextTalkingState = !this.isTalking;
    await this.webrtcService.setAdminMicEnabled(nextTalkingState);
  }

  // 2. WebSocket Fallback Stream (in case WebRTC P2P is blocked)
  private startWebSocketFallbackView() {
    const wsBase = environment.wsUrl || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

    // Screen WS Fallback
    try {
      this.screenWs = new WebSocket(`${wsBase}/ws/view-screen/${this.username}`);
      this.screenWs.onmessage = (event) => {
        this.screenFrame = event.data;
        this.isScreenUnavailable = false;
        this.lastUpdate = new Date();
        this.cdr.detectChanges();
      };
      this.screenWs.onerror = () => {
        console.warn('[LiveModal] WS Screen fallback unavailable');
      };
    } catch (e) {}

    // Camera WS Fallback
    try {
      this.cameraWs = new WebSocket(`${wsBase}/ws/view-camera/${this.username}`);
      this.cameraWs.onmessage = (event) => {
        this.cameraFrame = event.data;
        this.lastUpdate = new Date();
        this.cdr.detectChanges();
      };
      this.cameraWs.onerror = () => {
        console.warn('[LiveModal] WS Camera fallback unavailable');
      };
    } catch (e) {}
  }

  ngOnDestroy() {
    if (this.screenTimeout) {
      clearTimeout(this.screenTimeout);
      this.screenTimeout = null;
    }
    this.subs.forEach(s => s.unsubscribe());
    this.webrtcService.disconnect();

    if (this.screenWs) {
      try { this.screenWs.close(); } catch (e) {}
      this.screenWs = null;
    }
    if (this.cameraWs) {
      try { this.cameraWs.close(); } catch (e) {}
      this.cameraWs = null;
    }
  }

  close() {
    this.modalCtrl.dismiss();
  }
}
