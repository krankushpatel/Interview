import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-admin-live-tracking',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../admin.page.scss'],
  template: `
    <div class="view active">
      <div class="page-header">
        <div>
          <h1 class="page-title">Live Tracking</h1>
          <p class="page-subtitle">Real-time monitoring of active exams</p>
        </div>
        <div class="live-header-badge">
          <span class="live-pulse-dot"></span>
          <span>Live</span>
        </div>
      </div>

      <div class="live-kpi-row">
        <div class="live-kpi-card">
          <div class="live-kpi-value live-kpi-green">{{ liveExamsCount }}</div>
          <div class="live-kpi-label">Active Students</div>
        </div>
        <div class="live-kpi-card">
          <div class="live-kpi-value live-kpi-indigo">{{ totalQuestionsAnswered }}</div>
          <div class="live-kpi-label">Questions Answered</div>
        </div>
      </div>

      <div class="live-grid">
        <div
          *ngFor="let exam of liveExams"
          class="live-exam-card"
          (click)="viewLiveExam.emit(exam.username)"
        >
          <div
            class="live-card-status-bar"
            [class.status-active]="exam.status === 'active'"
            [class.status-idle]="exam.status === 'idle'"
            [class.status-terminated]="exam.status === 'terminated'"
          ></div>

          <div class="live-card-top">
            <div class="live-exam-avatar">{{ (exam.username || '?').charAt(0).toUpperCase() }}</div>
            <div class="live-exam-identity">
              <div class="live-exam-username">{{ exam.username }}</div>
              <div class="live-exam-status-label">
                <span class="live-pulse-dot" *ngIf="exam.status === 'active'"></span>
                {{ exam.status === 'active' ? 'Taking Exam' : exam.status === 'idle' ? '🟡 Idle' : '🔴 Terminated' }}
              </div>
            </div>
            <div class="live-timer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              {{ formatTime(exam.time_spent_seconds) }}
            </div>
          </div>

          <div class="live-progress-section">
            <div class="live-progress-labels">
              <span>Progress</span>
              <span class="live-progress-count">{{ exam.answered_count }}/{{ exam.total_questions }}</span>
            </div>
            <div class="live-progress-track">
              <div
                class="live-progress-fill"
                [style.width.%]="(exam.answered_count / (exam.total_questions || 1)) * 100"
                [class.fill-active]="exam.status === 'active'"
              ></div>
            </div>
            <div class="live-progress-pct">
              {{ ((exam.answered_count / (exam.total_questions || 1)) * 100) | number:'1.0-0' }}%
            </div>
          </div>

          <div class="live-details">
            <div class="live-detail-row">
              <span class="live-detail-label">Started</span>
              <span class="live-detail-val">{{ exam.started_at | date:'hh:mm a' }}</span>
            </div>
            <div class="live-detail-row">
              <span class="live-detail-label">Current Q</span>
              <span class="live-detail-val live-detail-q" [title]="exam.current_question_text">
                <strong *ngIf="exam.current_question_index !== undefined && exam.current_question_index >= 0" style="color: #60a5fa;">Q{{ exam.current_question_index + 1 }}: </strong>
                {{ exam.current_question_text || 'Waiting for question…' }}
              </span>
            </div>
          </div>

          <div class="live-card-actions" (click)="$event.stopPropagation()">
            <button class="live-action-btn" (click)="viewProctoringLogs.emit({ username: exam.username })">
              📋 Proctor Logs
            </button>
            <button 
              class="live-action-btn" 
              style="background: rgba(34, 197, 94, 0.15); border-color: rgba(34, 197, 94, 0.35); color: #4ade80; font-weight: 600;" 
              (click)="viewLiveExam.emit(exam.username)"
              title="Open Live 30fps Video, Screen & 2-Way Intercom (WebRTC)">
              ⚡ WebRTC Live
            </button>
            <button 
              class="live-action-btn" 
              style="background: rgba(37, 99, 235, 0.15); border-color: rgba(37, 99, 235, 0.35); color: #60a5fa; font-weight: 600;" 
              (click)="startZoomMeeting.emit(exam.username)"
              title="Open Zoom Cloud Live Proctor in same tab">
              📹 Zoom Live
            </button>
          </div>
        </div>

        <div *ngIf="liveExams.length === 0" class="live-empty-state">
          <div class="live-empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
              <circle cx="12" cy="12" r="2"/>
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
            </svg>
          </div>
          <div class="live-empty-title">No active exams</div>
          <div class="live-empty-sub">This view updates automatically when students begin their interviews</div>
        </div>
      </div>
    </div>
  `
})
export class AdminLiveTrackingComponent {
  @Input() liveExams: any[] = [];
  @Input() liveExamsCount: number = 0;
  @Input() totalQuestionsAnswered: number = 0;

  @Output() viewLiveExam = new EventEmitter<string>();
  @Output() viewProctoringLogs = new EventEmitter<{ username: string }>();
  @Output() viewLiveScreen = new EventEmitter<string>();
  @Output() startZoomMeeting = new EventEmitter<string>();

  formatTime(seconds: number): string {
    if (!seconds || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
}