import { Component, Input, OnInit, OnDestroy, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ZoomProctorService, ZoomSessionInfo } from '../../services/zoom-proctor.service';
import { MeetingService } from '../../services/meeting.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-zoom-live-modal',
  standalone: true,
  imports: [CommonModule, IonicModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <ion-header>
      <ion-toolbar style="--background: #18181b; --color: #ffffff; border-bottom: 1px solid rgba(255,255,255,0.1);">
        <ion-title style="font-size: 1rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #2563eb; box-shadow: 0 0 8px #2563eb;"></span>
          📹 Zoom Live Proctor & Intercom: {{ username }}
        </ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="close()" style="--color: #a1a1aa; font-weight: 600;">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding" style="--background: #09090b; color: #f4f4f5;">
      <!-- Zoom Session Header Bar -->
      <div class="zoom-session-badge-row">
        <div class="badge-item">
          <span class="badge-dot" [class.connected]="isConnected"></span>
          <span>Zoom Status: <strong>{{ isConnected ? 'Active Cloud Session' : 'Connecting...' }}</strong></span>
        </div>
        <div class="badge-item" *ngIf="sessionInfo">
          <span>Session: <code class="session-code">{{ sessionInfo.session_name }}</code></span>
        </div>
        <div class="badge-item">
          <span class="protocol-pill">Zoom Engine</span>
        </div>
      </div>

      <!-- Current Question Banner -->
      <div class="current-question-bar" *ngIf="currentQuestionText">
        <div class="cq-header">
          <span class="cq-tag">
            <span class="cq-pulse"></span>
            ACTIVE QUESTION {{ currentQuestionIndex !== undefined ? '(Q' + (currentQuestionIndex + 1) + ')' : '' }}
          </span>
          <span class="cq-category" *ngIf="currentQuestionCategory">{{ currentQuestionCategory }}</span>
        </div>
        <div class="cq-body">{{ currentQuestionText }}</div>
      </div>

      <!-- Live Video Grid -->
      <div class="live-grid">
        <!-- Card 1: Camera Feed -->
        <div class="live-card">
          <div class="live-label">
            <span>📹 CANDIDATE CAMERA</span>
            <span class="stream-protocol-tag zoom-tag">
              ⚡ Zoom HD
            </span>
          </div>
          <div class="live-frame">
            <!-- Smooth Zero-Flicker Canvas Display -->
            <canvas #cameraCanvas class="live-canvas" [style.display]="hasCameraFrame ? 'block' : 'none'"></canvas>
            
            <div *ngIf="!hasCameraFrame" class="loading">
              <ion-spinner name="crescent" color="primary"></ion-spinner>
              <p>Streaming via Zoom Channel...</p>
            </div>
          </div>
        </div>

        <!-- Card 2: Screen Feed -->
        <div class="live-card">
          <div class="live-label">
            <span>🖥️ CANDIDATE SCREEN</span>
            <span class="stream-protocol-tag" [class.zoom-tag]="hasScreenFrame">
              {{ hasScreenFrame ? '⚡ Zoom Live' : '📱 Screen Inactive' }}
            </span>
          </div>
          <div class="live-frame">
            <!-- Smooth Zero-Flicker Screen Canvas -->
            <canvas #screenCanvas class="live-canvas" [style.display]="hasScreenFrame ? 'block' : 'none'"></canvas>
            
            <div *ngIf="!hasScreenFrame" class="loading" style="color: #9ca3af; text-align: center; padding: 1.5rem;">
              <span style="font-size: 2.2rem; display: block; margin-bottom: 0.5rem;">📱</span>
              <p style="font-weight: 600; color: #f3f4f6; margin: 0 0 0.25rem 0; font-size: 0.95rem;">Camera-Only / Mobile Device</p>
              <p style="font-size: 0.78rem; color: #9ca3af; margin: 0;">No active screen stream on candidate's device</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 2-Way Intercom & Controls -->
      <div class="intercom-toolbar">
        <div class="intercom-status-box">
          <span class="status-dot" [class.live-dot]="isTalking" [class.listen-dot]="!isTalking && listenAudio"></span>
          <span class="status-msg">
            {{ isTalking ? '🔴 Live Speaking to Student (Zoom Voice)...' : (listenAudio ? '🔊 Listening to Candidate Room (Zoom Channel)' : '🔇 Candidate Audio Muted') }}
          </span>
        </div>

        <div class="intercom-btn-group">
          <button class="intercom-action-btn listen-btn" [class.active]="listenAudio" (click)="toggleListenAudio()">
            <span>{{ listenAudio ? '🔇 Mute Audio' : '🔊 Listen Room' }}</span>
          </button>

          <button class="intercom-action-btn talk-btn" [class.talking]="isTalking" (click)="toggleTalk()">
            <span>{{ isTalking ? '🔴 Release Mic' : '🎙️ Talk to Student' }}</span>
          </button>
        </div>
      </div>

      <div class="live-info">
        <div class="info-badge">
          <span class="dot"></span>
          <span>Zoom Session Host Connected (Same Tab Modal)</span>
        </div>
        <div class="info-text">
          Target Candidate: <strong>{{ username }}</strong>
        </div>
      </div>
    </ion-content>
  `,
  styles: [`
    .zoom-session-badge-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(255,255,255,0.04);
      padding: 0.6rem 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
      border: 1px solid rgba(255,255,255,0.06);
      font-size: 0.85rem;
    }

    .badge-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #d4d4d8;
    }

    .badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #71717a;
      &.connected {
        background: #2563eb;
        box-shadow: 0 0 8px #2563eb;
      }
    }

    .session-code {
      background: rgba(37, 99, 235, 0.2);
      color: #93c5fd;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.8rem;
    }

    .protocol-pill {
      font-size: 0.72rem;
      background: #2563eb;
      color: #fff;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 12px;
    }

    .live-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.25rem;
      height: 480px;
    }

    .live-card {
      background: #141416;
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .current-question-bar {
      margin-bottom: 1rem;
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(59, 130, 246, 0.3);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      backdrop-filter: blur(8px);
    }
    .cq-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.35rem;
    }
    .cq-tag {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.75rem;
      font-weight: 700;
      color: #60a5fa;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .cq-pulse {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #3b82f6;
      box-shadow: 0 0 8px #3b82f6;
      animation: pulseTalking 1.5s infinite;
    }
    .cq-category {
      font-size: 0.75rem;
      background: rgba(147, 51, 234, 0.2);
      color: #c084fc;
      border: 1px solid rgba(147, 51, 234, 0.4);
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
    }
    .cq-body {
      font-size: 0.92rem;
      color: #f1f5f9;
      line-height: 1.45;
      font-weight: 500;
    }

    .live-label {
      padding: 0.75rem 1rem;
      background: rgba(0,0,0,0.6);
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
      &.zoom-tag {
        background: rgba(37, 99, 235, 0.25);
        color: #60a5fa;
        border: 1px solid rgba(37, 99, 235, 0.4);
      }
    }

    .live-frame {
      flex: 1;
      background: #000;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .live-video, .live-image, .live-canvas {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      color: #888;
      font-size: 0.85rem;
    }

    .intercom-toolbar {
      margin-top: 1rem;
      background: #18181b;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      padding: 0.75rem 1.25rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
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
      &.listen-dot {
        background: #22c55e;
        box-shadow: 0 0 8px rgba(34, 197, 94, 0.6);
      }
      &.live-dot {
        background: #ef4444;
        box-shadow: 0 0 12px rgba(239, 68, 68, 0.9);
        animation: pulseTalking 1s infinite;
      }
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
      padding: 0.55rem 1.1rem;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
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

    .live-info {
      margin-top: 0.75rem;
      padding: 0.6rem 0.75rem;
      background: rgba(255,255,255,0.04);
      border-radius: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .info-badge {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #60a5fa;
      font-size: 0.8rem;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #2563eb;
      animation: pulse 1.5s infinite;
    }

    .info-text {
      color: #888;
      font-size: 0.75rem;
    }

    @keyframes pulseTalking {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.3); opacity: 0.6; }
    }

    @keyframes pulseButton {
      0%, 100% { box-shadow: 0 0 8px rgba(220, 38, 38, 0.4); }
      50% { box-shadow: 0 0 18px rgba(220, 38, 38, 0.85); }
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    @media (max-width: 768px) {
      .live-grid {
        grid-template-columns: 1fr;
        height: auto;
      }
    }
  `]
})
export class ZoomLiveModalComponent implements OnInit, OnDestroy {
  @Input() username!: string;
  @Input() currentQuestionText: string = '';
  @Input() currentQuestionIndex: number = 0;
  @Input() currentQuestionCategory: string = '';

  @ViewChild('cameraCanvas') cameraCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('screenCanvas') screenCanvasRef!: ElementRef<HTMLCanvasElement>;

  isConnected: boolean = false;
  listenAudio: boolean = true;
  isTalking: boolean = false;
  hasCameraFrame: boolean = false;
  hasScreenFrame: boolean = false;
  sessionInfo: ZoomSessionInfo | null = null;

  private cameraWs: WebSocket | null = null;
  private screenWs: WebSocket | null = null;
  private liveExamsWs: WebSocket | null = null;
  private cameraImg = new Image();
  private screenImg = new Image();

  constructor(
    private modalCtrl: ModalController,
    private zoomProctor: ZoomProctorService,
    private meetingService: MeetingService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    try {
      if (this.username) {
        await this.meetingService.dispatchBot(this.username);
      }
    } catch (e) {
      console.warn('[ZoomLiveModal] Auto dispatch notice:', e);
    }
    this.connectLiveStreams();
    try {
      await this.initZoomProctor();
    } catch (e) {
      console.warn('[ZoomLiveModal] Zoom proctor init notice:', e);
    }
  }

  private async initZoomProctor() {
    this.sessionInfo = await this.zoomProctor.startAdminSession(this.username);
    if (this.sessionInfo) {
      this.isConnected = true;
      this.cdr.detectChanges();
    }
  }

  private drawFrameToCanvas(canvas: HTMLCanvasElement | undefined, img: HTMLImageElement, dataUrl: string, onRendered: () => void) {
    if (!canvas) return;
    img.onload = () => {
      if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
      }
      onRendered();
    };
    img.src = dataUrl;
  }

  private connectLiveStreams() {
    const wsBase = environment.wsUrl || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

    // Camera Live (Zero Flicker HTML5 Canvas Painting)
    try {
      this.cameraWs = new WebSocket(`${wsBase}/ws/view-camera/${this.username}`);
      this.cameraWs.onmessage = (e) => {
        if (!e.data || typeof e.data !== 'string') return;
        const canvas = this.cameraCanvasRef?.nativeElement;
        this.drawFrameToCanvas(canvas, this.cameraImg, e.data, () => {
          if (!this.hasCameraFrame) {
            this.hasCameraFrame = true;
            this.cdr.detectChanges();
          }
        });
      };
    } catch (e) {}

    // Screen Live (Zero Flicker HTML5 Canvas Painting)
    try {
      this.screenWs = new WebSocket(`${wsBase}/ws/view-screen/${this.username}`);
      this.screenWs.onmessage = (e) => {
        if (!e.data || typeof e.data !== 'string') return;
        const canvas = this.screenCanvasRef?.nativeElement;
        this.drawFrameToCanvas(canvas, this.screenImg, e.data, () => {
          if (!this.hasScreenFrame) {
            this.hasScreenFrame = true;
            this.cdr.detectChanges();
          }
        });
      };
    } catch (e) {}

    // Real-Time Active Question Sync
    try {
      this.liveExamsWs = new WebSocket(`${wsBase}/ws/admin/live-exams`);
      this.liveExamsWs.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          const exams = data.exams || data.liveExams || [];
          const myExam = exams.find((x: any) => x.username === this.username);
          if (myExam) {
            if (myExam.current_question_text) {
              this.currentQuestionText = myExam.current_question_text;
            }
            if (myExam.current_question_index !== undefined) {
              this.currentQuestionIndex = myExam.current_question_index;
            }
            this.cdr.detectChanges();
          }
        } catch (err) {}
      };
    } catch (e) {}
  }

  toggleListenAudio() {
    this.listenAudio = !this.listenAudio;
  }

  toggleTalk() {
    this.isTalking = !this.isTalking;
    this.zoomProctor.setAdminTalking(this.isTalking);
  }

  ngOnDestroy() {
    if (this.cameraWs) {
      try { this.cameraWs.close(); } catch (e) {}
      this.cameraWs = null;
    }
    if (this.screenWs) {
      try { this.screenWs.close(); } catch (e) {}
      this.screenWs = null;
    }
    if (this.liveExamsWs) {
      try { this.liveExamsWs.close(); } catch (e) {}
      this.liveExamsWs = null;
    }
    this.zoomProctor.leaveSession();
  }

  close() {
    this.modalCtrl.dismiss();
  }
}

