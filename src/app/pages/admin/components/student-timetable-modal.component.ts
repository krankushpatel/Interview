import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

export interface StudentTimetablePayload {
  startDateOnly: string;
  startTimeOnly: string;
  startAmPm: string;
  endDateOnly: string;
  endTimeOnly: string;
  endAmPm: string;
  timetableTopics: string;
  isZoomSchedule?: boolean;
  isGoogleMeetSchedule?: boolean;
  googleMeetUrl?: string;
  isTeamsSchedule?: boolean;
  teamsUrl?: string;
}

@Component({
  selector: 'app-student-timetable-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../admin.page.scss'],
  template: `
    <ion-modal class="auto-fit-modal" [isOpen]="isOpen" (ionModalDidDismiss)="onDismiss()">
      <ng-template>
        <div style="background: var(--dip-surface, #ffffff); width: 100%; border-radius: 16px; overflow: hidden; display: flex; flex-direction: column;">
          <ion-header class="ion-no-border">
            <ion-toolbar class="modal-toolbar">
              <ion-title>📅 Schedule: {{ studentUsername }}</ion-title>
              <ion-buttons slot="end">
                <ion-button (click)="onDismiss()">Close</ion-button>
              </ion-buttons>
            </ion-toolbar>
          </ion-header>
          <div class="modal-body" style="overflow-y: auto; max-height: 80vh;">
            <div class="modal-field">
              <label class="field-label">Start Date & Time</label>
              <div style="display: flex; gap: 8px;">
                <input type="date" class="field-input" [(ngModel)]="startDateOnly" style="flex: 2;" [min]="minDateOnly" />
                <input type="time" class="field-input" [(ngModel)]="startTimeOnly" style="flex: 1.5;" />
                <select class="field-select" [(ngModel)]="startAmPm" style="flex: 1;">
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>
            <div class="modal-field">
              <label class="field-label">End Date & Time</label>
              <div style="display: flex; gap: 8px;">
                <input type="date" class="field-input" [(ngModel)]="endDateOnly" style="flex: 2;" [min]="startDateOnly" />
                <input type="time" class="field-input" [(ngModel)]="endTimeOnly" style="flex: 1.5;" />
                <select class="field-select" [(ngModel)]="endAmPm" style="flex: 1;">
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>
            <div class="modal-field">
              <label class="field-label">Message / Instructions (Optional)</label>
              <textarea
                class="field-textarea"
                [(ngModel)]="timetableTopics"
                rows="3"
                placeholder="e.g. Prepare for Python & Data Structures interview..."
              ></textarea>
            </div>

            <!-- 🎯 Interview Mode / Platform Selection -->
            <div class="modal-field" style="margin-top: 12px; border-top: 1px solid var(--dip-border, #e2e8f0); padding-top: 12px;">
              <span class="field-label" style="font-weight: 700; font-size: 13px; color: #1e293b; margin-bottom: 8px; display: block;">
                🎯 Interview Mode / Platform:
              </span>

              <!-- Mode Selection Buttons -->
              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 6px; margin-bottom: 10px;">
                <button
                  type="button"
                  (click)="interviewMode = 'portal'"
                  [style.border-color]="interviewMode === 'portal' ? '#2563eb' : '#cbd5e1'"
                  [style.background]="interviewMode === 'portal' ? 'rgba(37, 99, 235, 0.08)' : '#f8fafc'"
                  style="padding: 10px 4px; border: 2px solid; border-radius: 8px; font-weight: 700; font-size: 11px; cursor: pointer; text-align: center; color: #1e293b;"
                >
                  💻 Portal
                </button>
                <button
                  type="button"
                  (click)="interviewMode = 'zoom'"
                  [style.border-color]="interviewMode === 'zoom' ? '#2563eb' : '#cbd5e1'"
                  [style.background]="interviewMode === 'zoom' ? 'rgba(37, 99, 235, 0.08)' : '#f8fafc'"
                  style="padding: 10px 4px; border: 2px solid; border-radius: 8px; font-weight: 700; font-size: 11px; cursor: pointer; text-align: center; color: #1e40af;"
                >
                  📹 Zoom
                </button>
                <button
                  type="button"
                  (click)="interviewMode = 'meet'"
                  [style.border-color]="interviewMode === 'meet' ? '#059669' : '#cbd5e1'"
                  [style.background]="interviewMode === 'meet' ? 'rgba(5, 150, 105, 0.08)' : '#f8fafc'"
                  style="padding: 10px 4px; border: 2px solid; border-radius: 8px; font-weight: 700; font-size: 11px; cursor: pointer; text-align: center; color: #065f46;"
                >
                  🌐 Meet
                </button>
                <button
                  type="button"
                  (click)="interviewMode = 'teams'"
                  [style.border-color]="interviewMode === 'teams' ? '#5b5fc7' : '#cbd5e1'"
                  [style.background]="interviewMode === 'teams' ? 'rgba(91, 95, 199, 0.08)' : '#f8fafc'"
                  style="padding: 10px 4px; border: 2px solid; border-radius: 8px; font-weight: 700; font-size: 11px; cursor: pointer; text-align: center; color: #4338ca;"
                >
                  🟣 Teams
                </button>
              </div>

              <!-- Portal Info Box -->
              <div *ngIf="interviewMode === 'portal'" style="background: rgba(100, 116, 139, 0.06); border: 1px solid rgba(100, 116, 139, 0.2); border-radius: 8px; padding: 10px 12px; font-size: 11px; color: #475569; line-height: 1.4;">
                💻 <strong>Browser Portal:</strong> Student logs into <code>/student</code> portal during scheduled time window with web camera & mic.
              </div>

              <!-- Zoom Info Box -->
              <div *ngIf="interviewMode === 'zoom'" style="background: rgba(37, 99, 235, 0.06); border: 1px solid rgba(37, 99, 235, 0.2); border-radius: 8px; padding: 10px 12px; font-size: 11px; color: #1e40af; line-height: 1.4;">
                📹 <strong>Zoom Bot Interview:</strong> Auto-provisions meeting with passcode, locks timetable, sends 1-Click Zoom App launcher, and dispatches in-meeting AI bot.
              </div>

              <!-- Google Meet Info Box + Optional URL (Auto-Creates OPEN Room via Workspace API!) -->
              <div *ngIf="interviewMode === 'meet'" style="background: rgba(5, 150, 105, 0.06); border: 1px solid rgba(5, 150, 105, 0.2); border-radius: 8px; padding: 10px 12px; font-size: 11px; color: #065f46; line-height: 1.4;">
                🌐 <strong>Google Meet Auto-Entry (Workspace Enterprise):</strong> Leave the link blank to <strong>auto-create an OPEN Google Meet room</strong> (students with personal Gmail enter directly without knocking!), OR paste a custom link below:
                <div style="margin-top: 8px;">
                  <label style="font-weight: 700; font-size: 11px; color: #047857; display: block; margin-bottom: 4px;">
                    Google Meet Link (Optional — leave blank to Auto-Create):
                  </label>
                  <input
                    type="text"
                    [(ngModel)]="googleMeetUrl"
                    (input)="meetUrlError = ''"
                    placeholder="Leave blank for Auto-Create, or paste https://meet.google.com/abc-defg-hij"
                    style="width: 100%; padding: 6px 10px; font-size: 12px; border: 1px solid #a7f3d0; border-radius: 6px; background: #ffffff;"
                  />
                  <div style="margin-top: 6px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    <button type="button" (click)="openGoogleMeetNew()" style="background: #059669; color: white; border: none; padding: 4px 10px; border-radius: 6px; font-size: 10px; font-weight: 600; cursor: pointer;">
                      ➕ Manual Meet Room
                    </button>
                    <span style="font-size: 10px; color: #047857;">(Optional fallback if not using Workspace API)</span>
                  </div>
                  <div *ngIf="meetUrlError" style="color: #dc2626; font-size: 11px; margin-top: 4px; font-weight: 600;">
                    ⚠️ {{ meetUrlError }}
                  </div>
                </div>
              </div>

              <!-- Microsoft Teams Info Box + Required Real URL Input -->
              <div *ngIf="interviewMode === 'teams'" style="background: rgba(91, 95, 199, 0.06); border: 1px solid rgba(91, 95, 199, 0.2); border-radius: 8px; padding: 10px 12px; font-size: 11px; color: #4338ca; line-height: 1.4;">
                🟣 <strong>Microsoft Teams AI Interview:</strong> Copy a meeting link from Microsoft Teams or click below to open Teams, then paste it here:
                <div style="margin-top: 8px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                  <button type="button" (click)="openTeamsNew()" style="background: #5b5fc7; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                    <span>➕ Open Microsoft Teams</span>
                  </button>
                  <span style="font-size: 10px; color: #5b5fc7;">(Opens teams.microsoft.com in new tab)</span>
                </div>
                <div style="margin-top: 8px;">
                  <label style="font-weight: 700; font-size: 11px; color: #4338ca; display: block; margin-bottom: 4px;">
                    Paste Microsoft Teams Link here (Required):
                  </label>
                  <input
                    type="text"
                    [(ngModel)]="teamsUrl"
                    (input)="teamsUrlError = ''"
                    placeholder="https://teams.microsoft.com/l/meetup-join/..."
                    style="width: 100%; padding: 6px 10px; font-size: 12px; border: 1px solid #ddd6fe; border-radius: 6px; background: #ffffff;"
                  />
                  <div *ngIf="teamsUrlError" style="color: #dc2626; font-size: 11px; margin-top: 4px; font-weight: 600;">
                    ⚠️ {{ teamsUrlError }}
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-actions">
              <button
                class="btn btn-danger-outline"
                *ngIf="hasCurrentTimetable"
                (click)="onDelete()"
                [disabled]="isSaving"
              >
                Delete
              </button>
              <button
                class="btn btn-primary"
                (click)="onSave()"
                [disabled]="isSaving"
                style="display: flex; align-items: center;"
              >
                <div
                  class="loading-spinner"
                  *ngIf="isSaving"
                  style="width:14px;height:14px;margin-right:8px;border-width:2px;border-color:rgba(255,255,255,.3);border-top-color:white"
                ></div>
                {{ isSaving ? 'Saving...' : '💾 Save Schedule' }}
              </button>
            </div>
          </div>
        </div>
      </ng-template>
    </ion-modal>
  `
})
export class StudentTimetableModalComponent {
  @Input() isOpen: boolean = false;
  @Input() studentUsername: string = '';
  @Input() minDateOnly: string = '';
  @Input() startDateOnly: string = '';
  @Input() startTimeOnly: string = '09:00';
  @Input() startAmPm: string = 'AM';
  @Input() endDateOnly: string = '';
  @Input() endTimeOnly: string = '05:00';
  @Input() endAmPm: string = 'PM';
  @Input() timetableTopics: string = '';
  @Input() hasCurrentTimetable: boolean = false;
  @Input() isSaving: boolean = false;
  interviewMode: 'portal' | 'zoom' | 'meet' | 'teams' = 'portal';
  googleMeetUrl: string = '';
  meetUrlError: string = '';
  teamsUrl: string = '';
  teamsUrlError: string = '';
  isZoomSchedule: boolean = false;

  @Output() dismiss = new EventEmitter<void>();
  @Output() save = new EventEmitter<StudentTimetablePayload>();
  @Output() delete = new EventEmitter<void>();

  openGoogleMeetNew() {
    window.open('https://meet.google.com/new', '_blank');
  }

  openTeamsNew() {
    window.open('https://teams.microsoft.com', '_blank');
  }

  onDismiss() {
    this.meetUrlError = '';
    this.teamsUrlError = '';
    this.dismiss.emit();
  }

  onSave() {
    this.meetUrlError = '';
    this.teamsUrlError = '';
    if (this.interviewMode === 'meet') {
      const raw = (this.googleMeetUrl || '').trim();
      const match = raw.match(/https?:\/\/meet\.google\.com\/[a-zA-Z0-9_\-]+/i);
      const url = match ? match[0] : raw;
      this.googleMeetUrl = url;
      if (url && !url.includes('meet.google.com/')) {
        this.meetUrlError = 'Valid Google Meet link daalein (e.g. https://meet.google.com/abc-defg-hij), ya Auto-Create ke liye khali chhod dein.';
        return;
      }
    }

    if (this.interviewMode === 'teams') {
      const raw = (this.teamsUrl || '').trim();
      if (!raw) {
        this.teamsUrlError = 'Microsoft Teams meeting link paste karna zaroori hai!';
        return;
      }
      const match = raw.match(/https?:\/\/(?:teams\.microsoft\.com|teams\.live\.com)[^\s\)"'>\]]+/i);
      const url = match ? match[0].replace(/[.,;]+$/, '') : raw;
      this.teamsUrl = url;
      if (!url.includes('teams.microsoft.com') && !url.includes('teams.live.com')) {
        this.teamsUrlError = 'Valid Microsoft Teams link daalein (e.g. https://teams.microsoft.com/l/meetup-join/...)';
        return;
      }
    }

    this.save.emit({
      startDateOnly: this.startDateOnly,
      startTimeOnly: this.startTimeOnly,
      startAmPm: this.startAmPm,
      endDateOnly: this.endDateOnly,
      endTimeOnly: this.endTimeOnly,
      endAmPm: this.endAmPm,
      timetableTopics: this.timetableTopics,
      isZoomSchedule: this.interviewMode === 'zoom' || this.isZoomSchedule,
      isGoogleMeetSchedule: this.interviewMode === 'meet',
      googleMeetUrl: this.googleMeetUrl.trim(),
      isTeamsSchedule: this.interviewMode === 'teams',
      teamsUrl: this.teamsUrl.trim()
    });
  }

  onDelete() {
    this.delete.emit();
  }
}
