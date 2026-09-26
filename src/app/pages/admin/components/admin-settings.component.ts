import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

export interface ExamSettings {
  question_timer_seconds: number;
  max_attempts_default: number;
  allow_typing?: boolean;
}

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="view active">
      <div class="page-header">
        <div>
          <h1 class="page-title">Settings</h1>
          <p class="page-subtitle">Configure exam timer, input methods, and student defaults</p>
        </div>
      </div>

      <div *ngIf="settingsLoading" class="settings-loading">
        <div class="loading-spinner" style="width:24px;height:24px;border-width:3px"></div>
        <span>Loading settings...</span>
      </div>

      <div *ngIf="!settingsLoading" class="settings-container">
        <!-- Interview Timer -->
        <div class="settings-card">
          <div class="settings-card-header">
            <div class="settings-card-icon settings-icon-indigo">⏱</div>
            <div>
              <div class="settings-card-title">Interview Timer</div>
              <div class="settings-card-sub">Time given to each student per question</div>
            </div>
          </div>

          <div class="settings-field">
            <label class="field-label">Time Per Question</label>
            <div class="timer-presets">
              <button class="timer-preset-btn" [class.active]="examSettings.question_timer_seconds === 60" (click)="setTimer(60)">1 min</button>
              <button class="timer-preset-btn" [class.active]="examSettings.question_timer_seconds === 120" (click)="setTimer(120)">2 min</button>
              <button class="timer-preset-btn" [class.active]="examSettings.question_timer_seconds === 180" (click)="setTimer(180)">3 min</button>
              <button class="timer-preset-btn" [class.active]="examSettings.question_timer_seconds === 300" (click)="setTimer(300)">5 min</button>
              <button class="timer-preset-btn" [class.active]="examSettings.question_timer_seconds === 600" (click)="setTimer(600)">10 min</button>
              <button class="timer-preset-btn" [class.active]="examSettings.question_timer_seconds === 900" (click)="setTimer(900)">15 min</button>
            </div>
            <div class="timer-custom-row">
              <span class="field-label" style="margin-bottom:0;text-transform:none;letter-spacing:0">Custom (seconds):</span>
              <input type="number" class="field-input settings-input-sm" [(ngModel)]="examSettings.question_timer_seconds" min="30" max="3600" step="30" />
            </div>
            <div class="timer-preview">
              <div class="timer-preview-clock">{{ formatTimerPreview(examSettings.question_timer_seconds) }}</div>
              <div class="timer-preview-label">Timer shown to student</div>
            </div>
          </div>

          <div class="settings-field" style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border);">
            <label class="field-label">Input Methods</label>
            <label class="toggle-wrap" style="margin-top: 0.5rem;">
              <input type="checkbox" [(ngModel)]="examSettings.allow_typing" />
              <span class="toggle-slider"></span>
              <span class="toggle-label">
                <strong style="color: var(--text-primary);">Allow Keyboard Typing</strong><br>
                <span style="font-size: 0.8rem; opacity: 0.8;">If disabled, students can only answer using the Voice (Mic) feature. Textbox will be read-only.</span>
              </span>
            </label>
          </div>
        </div>

        <!-- Student Defaults -->
        <div class="settings-card">
          <div class="settings-card-header">
            <div class="settings-card-icon settings-icon-violet">👤</div>
            <div>
              <div class="settings-card-title">Student Defaults</div>
              <div class="settings-card-sub">Default values applied to new students</div>
            </div>
          </div>
          <div class="settings-field">
            <label class="field-label">Default Max Attempts</label>
            <div class="settings-input-with-hint">
              <input type="number" class="field-input settings-input-sm" [(ngModel)]="examSettings.max_attempts_default" min="1" max="10" />
              <span class="settings-hint">How many times a new student can take the exam by default</span>
            </div>
          </div>
        </div>

        <div class="settings-actions">
          <button class="btn btn-outline" (click)="onReset()" [disabled]="settingsSaving">↺ Reset to Defaults</button>
          <button class="btn btn-primary settings-save-btn" (click)="onSave()" [disabled]="settingsSaving">
            <div class="loading-spinner" *ngIf="settingsSaving" style="width:14px;height:14px;margin-right:6px;border-width:2px"></div>
            <span *ngIf="!settingsSaving && !settingsSaved">💾 Save Settings</span>
            <span *ngIf="settingsSaved">✅ Saved!</span>
            <span *ngIf="settingsSaving">Saving...</span>
          </button>
        </div>
      </div>
    </div>
  `
})
export class AdminSettingsComponent {
  @Input() examSettings: ExamSettings = {
    question_timer_seconds: 180,
    max_attempts_default: 3,
    allow_typing: true
  };
  @Input() settingsLoading: boolean = false;
  @Input() settingsSaving: boolean = false;
  @Input() settingsSaved: boolean = false;

  @Output() save = new EventEmitter<ExamSettings>();
  @Output() resetSettings = new EventEmitter<void>();

  setTimer(seconds: number) {
    this.examSettings.question_timer_seconds = seconds;
  }

  formatTimerPreview(seconds: number): string {
    if (!seconds || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  onSave() {
    this.save.emit(this.examSettings);
  }

  onReset() {
    this.resetSettings.emit();
  }
}
