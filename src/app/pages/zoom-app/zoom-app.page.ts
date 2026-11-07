import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { QuestionService, Question, AnswerRecord } from '../../services/question.service';
import { SpeechService } from '../../services/speech.service';
import { ProctoringService, ProctorWarning } from '../../services/proctoring.service';
import { Subscription, lastValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import zoomSdk from '@zoom/appssdk';

@Component({
  selector: 'app-zoom-app',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  template: `
    <div class="zoom-sidebar-container">
      <!-- ─── TOPBAR ──────────────────────────────────────── -->
      <div class="zoom-topbar">
        <div class="brand">
          <div class="zoom-pill">
            <span class="dot"></span>
            <span>Zoom In-Client</span>
          </div>
          <div class="session-timer">⏱️ {{ formatTimer(timerSeconds) }}</div>
        </div>
        <div class="user-badge">
          <span class="avatar">{{ username.charAt(0).toUpperCase() }}</span>
          <span class="name">{{ username }}</span>
        </div>
      </div>

      <!-- ─── AI PROCTORING & SCREEN STREAM HUD ──────────── -->
      <div class="proctor-hud">
        <div class="proctor-left">
          <div class="mini-cam-box">
            <video #cameraPreview autoplay muted playsinline class="mini-cam-video"></video>
            <span class="proctor-status-pill" [class.danger]="multipleFacesAlert">
              <span class="pulse-dot" [class.dot-red]="multipleFacesAlert" [class.dot-green]="!multipleFacesAlert"></span>
              {{ multipleFacesAlert ? '🚨 2+ FACES DETECTED' : '👁️ AI Verified' }}
            </span>
          </div>
        </div>

        <div class="proctor-right">
          <button class="btn btn-screen-toggle" *ngIf="!isScreenStreaming" (click)="startScreenStream()">
            🖥️ Share Screen with Proctor
          </button>
          <div class="screen-streaming-badge" *ngIf="isScreenStreaming">
            <span class="pulse-dot dot-green"></span>
            <span>Live to Admin</span>
          </div>
        </div>
      </div>

      <!-- Multiple Faces Warning Banner -->
      <div class="multiple-faces-banner" *ngIf="multipleFacesAlert">
        ⚠️ <strong>Violation Alert:</strong> Multiple faces detected! Only the registered student is allowed in frame.
      </div>

      <!-- ─── PROGRESS BAR ────────────────────────────────── -->
      <div class="progress-section">
        <div class="progress-labels">
          <span>Question {{ currentIndex + 1 }} of {{ questions.length }}</span>
          <span>{{ Math.round(((currentIndex + 1) / (questions.length || 1)) * 100) }}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" [style.width.%]="((currentIndex + 1) / (questions.length || 1)) * 100"></div>
        </div>
      </div>

      <!-- ─── LOADING STATE ──────────────────────────────── -->
      <div *ngIf="isLoading" class="state-view">
        <ion-spinner name="crescent" color="primary"></ion-spinner>
        <p>Loading your interview questions...</p>
      </div>

      <!-- ─── COMPLETED STATE ────────────────────────────── -->
      <div *ngIf="!isLoading && isFinished" class="state-view finish-view">
        <div class="finish-icon">🎉</div>
        <h2>Interview Completed!</h2>
        <p>Thank you, <strong>{{ username }}</strong>. Your responses have been submitted and evaluated successfully.</p>
        <div class="finish-stats">
          <div class="stat-box">
            <span class="stat-val">{{ answeredBuffer.length }}</span>
            <span class="stat-lbl">Answered</span>
          </div>
          <div class="stat-box">
            <span class="stat-val">{{ questions.length - answeredBuffer.length }}</span>
            <span class="stat-lbl">Skipped</span>
          </div>
        </div>
        <p class="finish-sub">You may now close this Zoom sidebar panel.</p>
      </div>

      <!-- ─── ACTIVE QUESTION VIEW ────────────────────────── -->
      <div *ngIf="!isLoading && !isFinished && currentQuestion" class="question-view">
        <!-- Question Card -->
        <div class="q-card">
          <div class="q-card-header">
            <span class="q-category">{{ currentQuestion.category || 'General' }}</span>
            <span class="q-difficulty" [ngClass]="(currentQuestion.difficulty || 'medium').toLowerCase()">
              {{ currentQuestion.difficulty || 'Medium' }}
            </span>
          </div>

          <div class="q-text">
            {{ currentQuestion.question || 'Loading question...' }}
          </div>

          <div *ngIf="currentQuestion.image" class="q-image-box">
            <img [src]="currentQuestion.image" alt="Question Diagram" />
          </div>
        </div>

        <!-- Live Speech & Answer Box -->
        <div class="answer-card">
          <div class="answer-header">
            <span class="answer-title">📝 Your Live Answer</span>
            <span class="word-counter">{{ wordCount }} words</span>
          </div>

          <textarea
            class="answer-input"
            [(ngModel)]="answerText"
            (input)="onAnswerChange()"
            placeholder="Speak into your Zoom microphone, or type your answer here..."
            rows="6">
          </textarea>

          <!-- Mic status bar -->
          <div class="mic-status-bar">
            <button class="mic-toggle-btn" [class.listening]="isListening" (click)="toggleMic()">
              <span>{{ isListening ? '🔴 Mic Active' : '🎤 Enable Voice Input' }}</span>
            </button>
            <span class="mic-hint" *ngIf="isListening">Listening to your Zoom mic...</span>
          </div>
        </div>

        <!-- Autonomous Action Bar (Sticky at bottom) -->
        <div class="action-footer">
          <button class="btn btn-skip" (click)="skipQuestion()" [disabled]="isSubmitting">
            ⏩ Skip
          </button>
          
          <button class="btn btn-clear" (click)="clearAnswer()" [disabled]="!answerText || isSubmitting">
            🗑 Clear
          </button>

          <button
            class="btn btn-primary"
            (click)="submitAndNext()"
            [disabled]="isSubmitting || (!answerText.trim() && currentIndex < questions.length - 1)">
            <span *ngIf="!isSubmitting">
              {{ currentIndex >= questions.length - 1 ? '🎉 Submit Interview' : 'Next Question ➡️' }}
            </span>
            <span *ngIf="isSubmitting">Saving...</span>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100vh;
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .zoom-sidebar-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      max-width: 480px;
      margin: 0 auto;
      background: #0f172a;
    }

    /* Topbar */
    .zoom-topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1rem;
      background: #1e293b;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }

    .zoom-pill {
      display: flex;
      align-items: center;
      gap: 5px;
      background: rgba(37, 99, 235, 0.2);
      color: #60a5fa;
      border: 1px solid rgba(37, 99, 235, 0.4);
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.72rem;
      font-weight: 700;
    }

    .zoom-pill .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #3b82f6;
    }

    .session-timer {
      font-size: 0.85rem;
      font-weight: 700;
      color: #fbbf24;
      background: rgba(251, 191, 36, 0.1);
      padding: 2px 8px;
      border-radius: 6px;
    }

    .user-badge {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    .avatar {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #3b82f6;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      font-weight: 700;
    }

    .name {
      font-size: 0.85rem;
      font-weight: 600;
      color: #cbd5e1;
    }

    /* Proctor HUD */
    .proctor-hud {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.5rem 1rem;
      background: #111827;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      gap: 0.75rem;
    }

    .mini-cam-box {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      position: relative;
    }

    .mini-cam-video {
      width: 48px;
      height: 36px;
      border-radius: 6px;
      background: #000;
      object-fit: cover;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .proctor-status-pill {
      font-size: 0.72rem;
      font-weight: 700;
      color: #4ade80;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 9999px;
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.3);

      &.danger {
        color: #f87171;
        background: rgba(239, 68, 68, 0.2);
        border-color: rgba(239, 68, 68, 0.5);
        animation: pulse 1s infinite;
      }
    }

    .pulse-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      &.dot-green {
        background: #22c55e;
        box-shadow: 0 0 6px #22c55e;
      }
      &.dot-red {
        background: #ef4444;
        box-shadow: 0 0 6px #ef4444;
      }
    }

    .btn-screen-toggle {
      background: #2563eb;
      color: #fff;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 0.4rem 0.75rem;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      &:hover {
        background: #1d4ed8;
      }
    }

    .screen-streaming-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.75rem;
      font-weight: 700;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 3px 8px;
      border-radius: 9999px;
    }

    .multiple-faces-banner {
      background: #ef4444;
      color: #ffffff;
      padding: 0.5rem 1rem;
      font-size: 0.78rem;
      text-align: center;
      font-weight: 700;
      animation: pulse 1.2s infinite;
    }

    /* Progress section */
    .progress-section {
      padding: 0.75rem 1rem 0.5rem 1rem;
    }

    .progress-labels {
      display: flex;
      justify-content: space-between;
      font-size: 0.78rem;
      color: #94a3b8;
      font-weight: 600;
      margin-bottom: 0.35rem;
    }

    .progress-track {
      height: 6px;
      background: #334155;
      border-radius: 3px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: #3b82f6;
      border-radius: 3px;
      transition: width 0.3s ease;
    }

    /* Question view */
    .question-view {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 1rem;
      gap: 1rem;
    }

    .q-card {
      background: #1e293b;
      border-radius: 10px;
      padding: 1.15rem;
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    .q-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }

    .q-category {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
    }

    .q-difficulty {
      font-size: 0.72rem;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 6px;
      text-transform: uppercase;
      &.easy { background: rgba(34, 197, 94, 0.2); color: #4ade80; }
      &.medium { background: rgba(234, 179, 8, 0.2); color: #facc15; }
      &.hard { background: rgba(239, 68, 68, 0.2); color: #f87171; }
    }

    .q-text {
      font-size: 1rem;
      font-weight: 600;
      line-height: 1.5;
      color: #f1f5f9;
    }

    .q-image-box {
      margin-top: 0.75rem;
      border-radius: 8px;
      overflow: hidden;
      img {
        width: 100%;
        max-height: 180px;
        object-fit: contain;
        background: #0f172a;
      }
    }

    /* Answer Card */
    .answer-card {
      background: #1e293b;
      border-radius: 10px;
      padding: 1rem;
      border: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .answer-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .answer-title {
      font-size: 0.82rem;
      font-weight: 700;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .word-counter {
      font-size: 0.75rem;
      color: #64748b;
      font-weight: 600;
    }

    .answer-input {
      width: 100%;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #f8fafc;
      padding: 0.75rem;
      font-size: 0.88rem;
      line-height: 1.45;
      resize: vertical;
      min-height: 120px;
      outline: none;
      &:focus {
        border-color: #3b82f6;
      }
    }

    .mic-status-bar {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-top: 0.25rem;
    }

    .mic-toggle-btn {
      background: rgba(255, 255, 255, 0.08);
      color: #e2e8f0;
      border: 1px solid rgba(255, 255, 255, 0.15);
      padding: 0.4rem 0.8rem;
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      &.listening {
        background: rgba(239, 68, 68, 0.2);
        color: #f87171;
        border-color: rgba(239, 68, 68, 0.4);
      }
    }

    .mic-hint {
      font-size: 0.75rem;
      color: #38bdf8;
      font-style: italic;
    }

    /* Action footer */
    .action-footer {
      display: flex;
      gap: 0.5rem;
      padding: 0.85rem 1rem;
      background: #1e293b;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .btn {
      padding: 0.65rem 1rem;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }

    .btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .btn-skip {
      background: rgba(255, 255, 255, 0.06);
      color: #94a3b8;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .btn-clear {
      background: rgba(255, 255, 255, 0.06);
      color: #94a3b8;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .btn-primary {
      flex: 1;
      background: #2563eb;
      color: #ffffff;
      box-shadow: 0 2px 6px rgba(37, 99, 235, 0.4);
      &:hover:not(:disabled) {
        background: #1d4ed8;
      }
    }

    /* State views */
    .state-view {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      text-align: center;
      color: #94a3b8;
    }

    .finish-icon {
      font-size: 3.5rem;
      margin-bottom: 0.75rem;
    }

    .finish-view h2 {
      color: #f1f5f9;
      margin: 0 0 0.5rem 0;
      font-size: 1.35rem;
    }

    .finish-view p {
      color: #94a3b8;
      font-size: 0.88rem;
      margin: 0 0 1.25rem 0;
    }

    .finish-stats {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .stat-box {
      background: #1e293b;
      padding: 0.75rem 1.25rem;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
    }

    .stat-val {
      font-size: 1.5rem;
      font-weight: 800;
      color: #3b82f6;
    }

    .stat-lbl {
      font-size: 0.75rem;
      color: #64748b;
      font-weight: 600;
    }

    .finish-sub {
      font-size: 0.78rem;
      color: #64748b;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `]
})
export class ZoomAppPage implements OnInit, OnDestroy {
  @ViewChild('cameraPreview') cameraPreviewRef!: ElementRef<HTMLVideoElement>;

  username: string = 'Ankush';
  examSessionId: string = '';
  questions: Question[] = [];
  currentIndex: number = 0;
  currentQuestion: Question | null = null;
  answerText: string = '';
  wordCount: number = 0;

  isLoading: boolean = true;
  isFinished: boolean = false;
  isSubmitting: boolean = false;
  isListening: boolean = false;

  // Proctoring properties
  multipleFacesAlert: boolean = false;
  isScreenStreaming: boolean = false;
  private screenStream: MediaStream | null = null;
  private screenStreamWs: WebSocket | null = null;
  private screenStreamInterval: any = null;
  private cameraStream: MediaStream | null = null;
  private hiddenCanvas: HTMLCanvasElement = document.createElement('canvas');

  timerSeconds: number = 180;
  private timerInterval: any = null;
  answeredBuffer: AnswerRecord[] = [];
  private speechSub: Subscription | null = null;

  Math = Math;

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
    private qService: QuestionService,
    public speech: SpeechService,
    public proctor: ProctoringService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) { }

  async ngOnInit() {
    this.extractUserIdentity();
    await this.initZoomSdk();
    await this.loadQuestions();
    this.startTimer();
    this.initSpeechSubscription();
    this.autoStartMic();
    await this.autoLaunchZoomIfNeeded();
    setTimeout(() => {
      this.initCameraAndProctoring();
    }, 1000);
  }

  private extractUserIdentity() {
    const queryUser = this.route.snapshot.queryParamMap.get('username');
    if (queryUser) {
      this.username = queryUser;
    } else {
      this.username = sessionStorage.getItem('username') || 'Ankush';
    }
    this.examSessionId = `zoom_${this.username}_${Date.now()}`;
  }

  private async initZoomSdk() {
    try {
      if (typeof zoomSdk !== 'undefined' && zoomSdk.config) {
        await zoomSdk.config({
          capabilities: ['onMeetingConfigChanged', 'getRunningContext']
        });
        console.log('[ZoomApp] Zoom Apps SDK Configured successfully');
      }
    } catch (e) {
      console.warn('[ZoomApp] Running outside Zoom client or mock mode:', e);
    }
  }

  // ─── CAMERA & AI MULTIPLE FACE DETECTION ────────────────────────
  private async initCameraAndProctoring() {
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' }
      });

      if (this.cameraPreviewRef?.nativeElement) {
        this.cameraPreviewRef.nativeElement.srcObject = this.cameraStream;
        await this.cameraPreviewRef.nativeElement.play().catch(() => {});

        // Setup Proctoring warning listener for Multiple Faces
        this.proctor.start((warning: ProctorWarning) => {
          if (warning && warning.type === 'multiple_faces_detected') {
            this.ngZone.run(() => {
              this.multipleFacesAlert = true;
              this.cdr.detectChanges();
              this.logProctorViolation('multiple_faces_detected', warning.message || 'Multiple faces detected in camera');
            });
          }
        });

        // Start real-time face detection
        await this.proctor.startFaceDetection(this.cameraPreviewRef.nativeElement);
        console.log('[ZoomApp] Face detection started successfully');
      }
    } catch (e) {
      console.warn('[ZoomApp] Camera access skipped or already in use by Zoom client:', e);
    }
  }

  private logProctorViolation(type: string, detail: string) {
    this.http.post(`${environment.apiUrl}/proctor/log-event`, {
      username: this.username,
      event_type: type,
      detail: detail
    }).subscribe({ error: () => {} });
  }

  // ─── LIVE SCREEN STREAMING TO ADMIN ─────────────────────────────
  async startScreenStream() {
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' } as any
      });

      const helperVideo = document.createElement('video');
      helperVideo.autoplay = true;
      (helperVideo as any).playsInline = true;
      helperVideo.srcObject = this.screenStream;
      await helperVideo.play().catch(() => {});

      const wsUrl = environment.apiUrl.replace(/^http/, 'ws') + `/ws/stream-screen/${this.username}`;
      this.screenStreamWs = new WebSocket(wsUrl);

      this.screenStreamWs.onopen = () => {
        this.isScreenStreaming = true;
        this.cdr.detectChanges();

        this.ngZone.runOutsideAngular(() => {
          this.screenStreamInterval = setInterval(() => {
            if (this.screenStreamWs?.readyState === WebSocket.OPEN && helperVideo.readyState >= 2) {
              const canvas = this.hiddenCanvas;
              canvas.width = 640;
              canvas.height = 360;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(helperVideo, 0, 0, 640, 360);
                this.screenStreamWs.send(canvas.toDataURL('image/jpeg', 0.35));
              }
            }
          }, 1500);
        });
      };

      this.screenStream.getVideoTracks()[0].onended = () => {
        this.stopScreenStream();
      };
    } catch (err) {
      console.warn('[ZoomApp] Screen share cancelled or not allowed:', err);
    }
  }

  private stopScreenStream() {
    if (this.screenStreamInterval) clearInterval(this.screenStreamInterval);
    this.screenStreamInterval = null;
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }
    if (this.screenStreamWs) {
      this.screenStreamWs.close();
      this.screenStreamWs = null;
    }
    this.isScreenStreaming = false;
    this.cdr.detectChanges();
  }

  private autoStartMic() {
    try {
      this.isListening = true;
      this.speech.startListening(this.username, this.examSessionId);
    } catch (e) {
      console.warn('[ZoomApp] Auto-mic deferred until user interaction:', e);
    }
  }

  private async autoLaunchZoomIfNeeded() {
    const shouldLaunch = this.route.snapshot.queryParamMap.get('launch_zoom');
    if (shouldLaunch === 'true') {
      try {
        const schedule = await lastValueFrom(
          this.http.get<any>(`${environment.apiUrl}/student/exam-schedule/${this.username}`)
        );
        if (schedule?.zoom_host_url) {
          console.log('[ZoomApp] Launching Zoom via host URL (Zero waiting room)...');
          window.open(schedule.zoom_host_url, '_blank');
        } else if (schedule?.zoom_app_url) {
          console.log('[ZoomApp] Auto-launching native Zoom application...');
          window.location.href = schedule.zoom_app_url;
        }
      } catch (e) {
        console.warn('[ZoomApp] Auto-launch Zoom app skipped:', e);
      }
    }
  }

  private async loadQuestions() {
    this.isLoading = true;
    try {
      sessionStorage.setItem('username', this.username);
      this.questions = await this.qService.loadQuestions();
      if (this.questions.length > 0) {
        this.currentIndex = 0;
        this.currentQuestion = this.questions[0];
      }
    } catch (err) {
      console.error('[ZoomApp] Failed to load questions:', err);
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  private startTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerSeconds = 180;
    this.timerInterval = setInterval(() => {
      if (this.timerSeconds > 0) {
        this.timerSeconds--;
        this.cdr.detectChanges();
      } else {
        this.submitAndNext();
      }
    }, 1000);
  }

  formatTimer(totalSec: number): string {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  private initSpeechSubscription() {
    this.speechSub = this.speech.transcript$.subscribe(text => {
      if (text && this.isListening) {
        this.ngZone.run(() => {
          this.answerText = text;
          this.onAnswerChange();
          this.cdr.detectChanges();
        });
      }
    });
  }

  toggleMic() {
    this.isListening = !this.isListening;
    if (this.isListening) {
      this.speech.startListening(this.username, this.examSessionId);
    } else {
      this.speech.stopListening();
    }
  }

  onAnswerChange() {
    const words = this.answerText.trim().split(/\s+/).filter(w => w.length > 0);
    this.wordCount = words.length;
  }

  clearAnswer() {
    this.answerText = '';
    this.wordCount = 0;
  }

  // 1. Submit & Go Next (or Finish)
  async submitAndNext() {
    if (this.isSubmitting || !this.currentQuestion) return;
    this.isSubmitting = true;

    try {
      if (this.answerText.trim()) {
        await this.qService.submitAnswer(
          this.answerText,
          this.currentQuestion,
          this.answeredBuffer.length,
          this.currentIndex,
          this.examSessionId
        );

        this.answeredBuffer.push({
          question_id: this.currentQuestion.id,
          question_text: this.currentQuestion.question || '',
          category: this.currentQuestion.category,
          answer: this.answerText,
          session_id: this.examSessionId
        });
      }

      if (this.currentIndex >= this.questions.length - 1) {
        await this.finishInterview();
      } else {
        this.advanceToNext();
      }
    } catch (e) {
      console.error('[ZoomApp] Error submitting answer:', e);
      this.advanceToNext();
    } finally {
      this.isSubmitting = false;
      this.cdr.detectChanges();
    }
  }

  // 2. Skip Question
  skipQuestion() {
    if (this.isSubmitting) return;
    if (this.currentIndex >= this.questions.length - 1) {
      this.finishInterview();
    } else {
      this.advanceToNext();
    }
  }

  private advanceToNext() {
    this.currentIndex++;
    this.currentQuestion = this.questions[this.currentIndex];
    this.answerText = '';
    this.wordCount = 0;
    this.startTimer();
  }

  private async finishInterview() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.isListening) this.toggleMic();

    try {
      await this.qService.evaluate(
        this.username,
        this.answeredBuffer,
        [],
        this.examSessionId
      );
    } catch (e) {
      console.warn('[ZoomApp] Evaluation dispatch warning:', e);
    }

    this.isFinished = true;
    this.cdr.detectChanges();
  }

  ngOnDestroy() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.speechSub) this.speechSub.unsubscribe();
    if (this.isListening) this.speech.stopListening();
    this.stopScreenStream();
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(t => t.stop());
    }
    this.proctor.stop();
  }
}
