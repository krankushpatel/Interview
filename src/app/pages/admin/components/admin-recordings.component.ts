import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ExamRecording, ScreenRecording } from '../../../services/admin.service';

@Component({
  selector: 'app-admin-recordings',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Exam Recordings View -->
    <div class="view active" *ngIf="viewType === 'examvids'">
      <div class="page-header">
        <div>
          <h1 class="page-title">Exam Recordings</h1>
          <p class="page-subtitle">Full session videos from each student</p>
        </div>
      </div>
      <div class="info-banner">
        🎬 Each student's <strong>full exam session</strong> is recorded as one continuous video. Files are stored in <code>uploads/</code>.
      </div>
      <div *ngIf="recordings.length === 0" class="empty-state-full">
        <div class="esf-icon">🎬</div>
        <div class="esf-title">No exam recordings yet</div>
      </div>
      <div class="recordings-list" *ngIf="recordings.length > 0">
        <div *ngFor="let rec of recordings.slice(0, 10)" class="recording-card">
          <div class="rec-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="23 7 16 12 23 17 23 7"/>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
          </div>
          <div class="rec-info">
            <div class="rec-name">{{ rec.student_name }}</div>
            <div class="rec-user">&#64;{{ rec.username }}</div>
            <div class="rec-chips">
              <span class="chip chip-neutral">⏱ {{ formatDuration(rec.duration_sec) }}</span>
              <span class="chip chip-neutral">💾 {{ rec.size_mb }} MB</span>
            </div>
          </div>
          <div class="rec-date">{{ rec.submitted_at | date:'MMM d, h:mm a' }}</div>
          <button class="btn btn-outline btn-sm" (click)="playVideo.emit({ file: rec.video_file, name: rec.student_name })">
            ▶ Play
          </button>
        </div>
      </div>
    </div>

    <!-- Screen Recordings View -->
    <div class="view active" *ngIf="viewType === 'screenvids'">
      <div class="page-header">
        <div>
          <h1 class="page-title">Screen Recordings</h1>
          <p class="page-subtitle">Full screen recordings of student desktop activity</p>
        </div>
      </div>
      <div *ngIf="screenRecordings.length === 0" class="empty-state-full">
        <div class="esf-icon">🖥️</div>
        <div class="esf-title">No screen recordings yet</div>
      </div>
      <div class="recordings-list" *ngIf="screenRecordings.length > 0">
        <div *ngFor="let rec of screenRecordings.slice(0, 10)" class="recording-card">
          <div class="rec-icon">🖥️</div>
          <div class="rec-info">
            <div class="rec-name">{{ rec.student_name }}</div>
            <div class="rec-user">&#64;{{ rec.username }}</div>
            <div class="rec-chips">
              <span class="chip chip-neutral">💾 {{ rec.size_mb }} MB</span>
            </div>
          </div>
          <div class="rec-date">{{ rec.submitted_at | date:'MMM d, h:mm a' }}</div>
          <button class="btn btn-outline btn-sm" (click)="playScreenVideo.emit({ file: rec.video_file, name: rec.student_name })">
            ▶ Play
          </button>
        </div>
      </div>
    </div>
  `
})
export class AdminRecordingsComponent {
  @Input() viewType: 'examvids' | 'screenvids' = 'examvids';
  @Input() recordings: ExamRecording[] = [];
  @Input() screenRecordings: ScreenRecording[] = [];

  @Output() playVideo = new EventEmitter<{ file: string; name: string }>();
  @Output() playScreenVideo = new EventEmitter<{ file: string; name: string }>();

  formatDuration(durationSec: number): string {
    const m = Math.floor(durationSec / 60);
    const s = durationSec % 60;
    return `${m}m ${s}s`;
  }
}
