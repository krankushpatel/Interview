import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ThemeService, AppTheme } from '../../../services/theme.service';
import { MeetingService } from '../../../services/meeting.service';

export interface ExamSettings {
  question_timer_seconds: number;
  max_attempts_default: number;
  allow_typing?: boolean;
  conferencing_provider?: 'webrtc' | 'zoom' | 'google_meet';
  zoom_account_id?: string;
  zoom_client_id?: string;
  zoom_client_secret?: string;
}

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../admin.page.scss'],
  template: `
    <div class="view active">
      <div class="page-header">
        <div>
          <h1 class="page-title">Settings</h1>
          <p class="page-subtitle">Configure theme appearance, exam timer, input methods, conferencing & Zoom integrations</p>
        </div>
      </div>

      <div *ngIf="settingsLoading" class="settings-loading">
        <div class="loading-spinner" style="width:24px;height:24px;border-width:3px"></div>
        <span>Loading settings...</span>
      </div>

      <div *ngIf="!settingsLoading" class="settings-container">
        <!-- Appearance & Theme Card -->
        <div class="settings-card">
          <div class="settings-card-header">
            <div class="settings-card-icon" style="background: var(--c-amber-dim); font-size: 22px;">🎨</div>
            <div style="flex: 1;">
              <div class="settings-card-title">Appearance & Theme</div>
              <div class="settings-card-sub">Choose between Light and Dark interface mode for the admin panel</div>
            </div>
            <span class="chip" [class.chip-easy]="isLightMode" [class.chip-neutral]="!isLightMode">
              {{ isLightMode ? '☀️ Light Mode Active' : '🌙 Dark Mode Active' }}
            </span>
          </div>

          <div class="settings-field">
            <label class="field-label">Interface Mode</label>
            <div style="display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 1.25rem;">
              <!-- Light Theme Card Selector -->
              <div 
                (click)="onSetTheme('light')"
                style="flex: 1; min-width: 220px; padding: 16px; border-radius: var(--r-lg); border: 2px solid; cursor: pointer; transition: all var(--t-fast); display: flex; align-items: flex-start; gap: 12px;"
                [style.borderColor]="isLightMode ? 'var(--c-indigo)' : 'var(--border)'"
                [style.background]="isLightMode ? 'var(--c-indigo-dim)' : 'var(--bg-surface-2)'">
                <span style="font-size: 28px; line-height: 1;">☀️</span>
                <div style="flex: 1;">
                  <div style="display: flex; align-items: center; justify-content: space-between;">
                    <strong style="font-size: 14px; color: var(--text-primary);">Light Mode</strong>
                    <span *ngIf="isLightMode" style="color: var(--c-indigo); font-size: 13px; font-weight: 700;">✓ Active</span>
                  </div>
                  <p style="font-size: 12.5px; color: var(--text-secondary); margin: 4px 0 0; line-height: 1.4;">
                    Crisp, clean bright appearance with high contrast for comfortable daytime viewing.
                  </p>
                </div>
              </div>

              <!-- Dark Theme Card Selector -->
              <div 
                (click)="onSetTheme('dark')"
                style="flex: 1; min-width: 220px; padding: 16px; border-radius: var(--r-lg); border: 2px solid; cursor: pointer; transition: all var(--t-fast); display: flex; align-items: flex-start; gap: 12px;"
                [style.borderColor]="!isLightMode ? 'var(--c-indigo)' : 'var(--border)'"
                [style.background]="!isLightMode ? 'var(--c-indigo-dim)' : 'var(--bg-surface-2)'">
                <span style="font-size: 28px; line-height: 1;">🌙</span>
                <div style="flex: 1;">
                  <div style="display: flex; align-items: center; justify-content: space-between;">
                    <strong style="font-size: 14px; color: var(--text-primary);">Dark Mode</strong>
                    <span *ngIf="!isLightMode" style="color: var(--c-indigo); font-size: 13px; font-weight: 700;">✓ Active</span>
                  </div>
                  <p style="font-size: 12.5px; color: var(--text-secondary); margin: 4px 0 0; line-height: 1.4;">
                    Sleek dark slate aesthetic that reduces glare and eye strain in low-light environments.
                  </p>
                </div>
              </div>
            </div>

            <!-- Direct Toggle Switch ("Light Theme Switch") -->
            <div style="padding-top: 1rem; border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
              <div>
                <label class="field-label" style="margin-bottom: 2px;">Light Theme Toggle</label>
                <div style="font-size: 13px; color: var(--text-secondary);">
                  Switch between Light Mode (ON) and Dark Mode (OFF) instantly
                </div>
              </div>
              <label class="toggle-wrap" style="margin: 0;">
                <input type="checkbox" [checked]="isLightMode" (change)="onToggleLightSwitch($event)" />
                <span class="toggle-slider"></span>
                <span class="toggle-label" style="font-weight: 600; color: var(--text-primary);">
                  {{ isLightMode ? '☀️ Light' : '🌙 Dark' }}
                </span>
              </label>
            </div>
          </div>
        </div>

        <!-- 📹 Video Conferencing & Zoom Integration Card -->
        <div class="settings-card">
          <div class="settings-card-header">
            <div class="settings-card-icon" style="background: rgba(45, 140, 255, 0.15); font-size: 22px;">📹</div>
            <div style="flex: 1;">
              <div class="settings-card-title">Live Video & Interview Conferencing</div>
              <div class="settings-card-sub">Choose primary live monitoring provider and configure Zoom integration</div>
            </div>
            <span class="chip chip-easy">
              {{ examSettings.conferencing_provider === 'zoom' ? 'Zoom Active' : (examSettings.conferencing_provider === 'google_meet' ? 'Google Meet Active' : '⚡ WebRTC Active') }}
            </span>
          </div>

          <!-- Provider Selector -->
          <div class="settings-field">
            <label class="field-label">Preferred Interview Provider</label>
            <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 1rem;">
              <button 
                type="button" 
                class="timer-preset-btn" 
                [class.active]="!examSettings.conferencing_provider || examSettings.conferencing_provider === 'webrtc'" 
                (click)="examSettings.conferencing_provider = 'webrtc'">
                ⚡ Internal WebRTC (Ultra Low-Latency)
              </button>
              <button 
                type="button" 
                class="timer-preset-btn" 
                [class.active]="examSettings.conferencing_provider === 'zoom'" 
                (click)="examSettings.conferencing_provider = 'zoom'">
                📹 Zoom Video Meetings
              </button>
              <button 
                type="button" 
                class="timer-preset-btn" 
                [class.active]="examSettings.conferencing_provider === 'google_meet'" 
                (click)="examSettings.conferencing_provider = 'google_meet'">
                🌐 Google Meet
              </button>
            </div>
          </div>

          <!-- Zoom Configuration Fields -->
          <div style="background: var(--bg-surface-2); padding: 1.25rem; border-radius: var(--r-md); border: 1px solid var(--border); margin-top: 1rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
              <strong style="color: var(--text-primary); font-size: 0.95rem;">Zoom Server-to-Server OAuth Credentials</strong>
              <span style="font-size: 0.8rem; color: var(--text-secondary);">Managed in Zoom Marketplace</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
              <div>
                <label class="field-label" style="font-size: 0.75rem;">Account ID</label>
                <input 
                  type="text" 
                  class="field-input" 
                  [(ngModel)]="examSettings.zoom_account_id" 
                  placeholder="e.g. abcd1234efgh" />
              </div>
              <div>
                <label class="field-label" style="font-size: 0.75rem;">Client ID</label>
                <input 
                  type="text" 
                  class="field-input" 
                  [(ngModel)]="examSettings.zoom_client_id" 
                  placeholder="e.g. 5xYzaBC123" />
              </div>
            </div>

            <div style="margin-bottom: 12px;">
              <label class="field-label" style="font-size: 0.75rem;">Client Secret</label>
              <div style="position: relative;">
                <input 
                  [type]="showSecret ? 'text' : 'password'" 
                  class="field-input" 
                  [(ngModel)]="examSettings.zoom_client_secret" 
                  placeholder="Paste Client Secret here" />
                <button 
                  type="button" 
                  (click)="showSecret = !showSecret"
                  style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--text-secondary); font-size: 13px;">
                  {{ showSecret ? 'Hide' : 'Show' }}
                </button>
              </div>
            </div>

            <div style="display: flex; align-items: center; gap: 12px; margin-top: 12px;">
              <button 
                type="button" 
                class="btn btn-outline" 
                style="padding: 6px 14px; font-size: 0.85rem;" 
                (click)="onTestZoomConnection()" 
                [disabled]="zoomTesting || !examSettings.zoom_account_id || !examSettings.zoom_client_id">
                <span *ngIf="!zoomTesting">🔌 Test Zoom Connection</span>
                <span *ngIf="zoomTesting">Testing connection...</span>
              </button>

              <div *ngIf="zoomTestResult" style="font-size: 0.85rem;">
                <span *ngIf="zoomTestResult.success" style="color: #00e5a0; font-weight: 600;">
                  ✅ {{ zoomTestResult.message }}
                </span>
                <span *ngIf="!zoomTestResult.success" style="color: #ff5252; font-weight: 600;">
                  ❌ {{ zoomTestResult.message }}
                </span>
              </div>
            </div>
          </div>
        </div>

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
  private themeService = inject(ThemeService);
  private meetingService = inject(MeetingService);
  private cdr = inject(ChangeDetectorRef);

  @Input() examSettings: ExamSettings = {
    question_timer_seconds: 180,
    max_attempts_default: 3,
    allow_typing: true,
    conferencing_provider: 'webrtc',
    zoom_account_id: '',
    zoom_client_id: '',
    zoom_client_secret: ''
  };
  @Input() settingsLoading: boolean = false;
  @Input() settingsSaving: boolean = false;
  @Input() settingsSaved: boolean = false;

  @Output() save = new EventEmitter<ExamSettings>();
  @Output() resetSettings = new EventEmitter<void>();

  showSecret: boolean = false;
  zoomTesting: boolean = false;
  zoomTestResult: { success: boolean; message: string } | null = null;

  get isLightMode(): boolean {
    return this.themeService.currentTheme() === 'light';
  }

  onSetTheme(theme: AppTheme) {
    this.themeService.setTheme(theme);
    this.cdr.markForCheck();
  }

  onToggleLightSwitch(event: Event) {
    const input = event.target as HTMLInputElement;
    this.onSetTheme(input.checked ? 'light' : 'dark');
  }

  setTimer(seconds: number) {
    this.examSettings.question_timer_seconds = seconds;
  }

  formatTimerPreview(seconds: number): string {
    if (!seconds || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  async onTestZoomConnection() {
    if (!this.examSettings.zoom_account_id || !this.examSettings.zoom_client_id || !this.examSettings.zoom_client_secret) {
      this.zoomTestResult = { success: false, message: 'Please enter all 3 Zoom credentials' };
      this.cdr.markForCheck();
      return;
    }

    this.zoomTesting = true;
    this.zoomTestResult = null;
    this.cdr.markForCheck();

    try {
      const res = await this.meetingService.testZoomCredentials(
        this.examSettings.zoom_account_id,
        this.examSettings.zoom_client_id,
        this.examSettings.zoom_client_secret
      );
      this.zoomTestResult = {
        success: true,
        message: `Connected! Account: ${res.details?.email || res.details?.account_id || 'Active'}`
      };
      // Auto-save verified Zoom credentials to database immediately
      try {
        await this.meetingService.saveZoomCredentials(
          this.examSettings.zoom_account_id,
          this.examSettings.zoom_client_id,
          this.examSettings.zoom_client_secret
        );
      } catch (e) {}
    } catch (err: any) {
      this.zoomTestResult = {
        success: false,
        message: err?.error?.detail || err?.message || 'Connection failed. Check credentials.'
      };
    } finally {
      this.zoomTesting = false;
      this.cdr.markForCheck();
    }
  }

  onSave() {
    this.save.emit(this.examSettings);
  }

  onReset() {
    this.resetSettings.emit();
  }
}
