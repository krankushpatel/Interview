import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { QuestionService, Question, AnswerRecord } from '../../services/question.service';
import { SpeechService } from '../../services/speech.service';
import { Subscription } from 'rxjs';
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

    .user-badge .avatar {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #2563eb;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      font-weight: 700;
    }

    .user-badge .name {
      font-size: 0.85rem;
      font-weight: 600;
      color: #e2e8f0;
    }

    /* Progress section */
    .progress-section {
      padding: 0.6rem 1rem;
      background: #1e293b;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    .progress-labels {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 0.35rem;
    }

    .progress-track {
      height: 5px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: #3b82f6;
      transition: width 0.3s ease;
    }

    /* Question view scrollable */
    .question-view {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }

    /* Question card */
    .q-card {
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      padding: 1rem;
    }

    .q-card-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.6rem;
    }

    .q-category {
      background: rgba(99, 102, 241, 0.15);
      color: #818cf8;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 700;
    }

    .q-difficulty {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 4px;
      &.easy { color: #34d399; background: rgba(52, 211, 153, 0.1); }
      &.medium { color: #fbbf24; background: rgba(251, 191, 36, 0.1); }
      &.hard { color: #f87171; background: rgba(248, 113, 113, 0.1); }
    }

    .q-text {
      font-size: 0.98rem;
      font-weight: 600;
      line-height: 1.5;
      color: #f1f5f9;
    }

    .q-image-box {
      margin-top: 0.75rem;
      border-radius: 6px;
      overflow: hidden;
      max-height: 180px;
    }

    .q-image-box img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    /* Answer card */
    .answer-card {
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      padding: 0.85rem;
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
    }

    .word-counter {
      font-size: 0.75rem;
      color: #64748b;
      font-weight: 600;
    }

    .answer-input {
      width: 100%;
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.1);
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
      font-size: 1.35rem;
      color: #f8fafc;
      margin: 0 0 0.5rem 0;
    }

    .finish-view p {
      font-size: 0.88rem;
      line-height: 1.5;
      color: #94a3b8;
    }

    .finish-stats {
      display: flex;
      gap: 1.5rem;
      margin: 1.25rem 0;
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
  `]
})
export class ZoomAppPage implements OnInit, OnDestroy {
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

  timerSeconds: number = 180;
  private timerInterval: any = null;
  answeredBuffer: AnswerRecord[] = [];
  private speechSub: Subscription | null = null;

  Math = Math;

  constructor(
    private route: ActivatedRoute,
    private qService: QuestionService,
    public speech: SpeechService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) { }

  async ngOnInit() {
    this.extractUserIdentity();
    await this.initZoomSdk();
    await this.loadQuestions();
    this.startTimer();
    this.initSpeechSubscription();
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
        // Auto-advance on time expiration (autonomous flow)
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

      // Check if this was the last question
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
      // Trigger evaluation in backend
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
  }
}

