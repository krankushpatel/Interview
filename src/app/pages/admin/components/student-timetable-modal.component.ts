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
              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 10px;">
                <button
                  type="button"
                  (click)="interviewMode = 'portal'"
                  [style.border-color]="interviewMode === 'portal' ? '#2563eb' : '#cbd5e1'"
                  [style.background]="interviewMode === 'portal' ? 'rgba(37, 99, 235, 0.08)' : '#f8fafc'"
                  style="padding: 10px 8px; border: 2px solid; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer; text-align: center; color: #1e293b;"
                >
                  💻 Portal Exam
                </button>
                <button
                  type="button"
                  (click)="interviewMode = 'zoom'"
                  [style.border-color]="interviewMode === 'zoom' ? '#2563eb' : '#cbd5e1'"
                  [style.background]="interviewMode === 'zoom' ? 'rgba(37, 99, 235, 0.08)' : '#f8fafc'"
                  style="padding: 10px 8px; border: 2px solid; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer; text-align: center; color: #1e40af;"
                >
                  📹 Zoom Call
                </button>
                <button
                  type="button"
                  (click)="interviewMode = 'meet'"
                  [style.border-color]="interviewMode === 'meet' ? '#059669' : '#cbd5e1'"
                  [style.background]="interviewMode === 'meet' ? 'rgba(5, 150, 105, 0.08)' : '#f8fafc'"
                  style="padding: 10px 8px; border: 2px solid; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer; text-align: center; color: #065f46;"
                >
                  🌐 Google Meet
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

              <!-- Google Meet Info Box + Required Real URL Input -->
              <div *ngIf="interviewMode === 'meet'" style="background: rgba(5, 150, 105, 0.06); border: 1px solid rgba(5, 150, 105, 0.2); border-radius: 8px; padding: 10px 12px; font-size: 11px; color: #065f46; line-height: 1.4;">
                🌐 <strong>Google Meet AI Interview:</strong> Google Meet requires a real room created from your Google account. Click below to generate one in 2 seconds, then paste it here:
                <div style="margin-top: 8px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                  <button type="button" (click)="openGoogleMeetNew()" style="background: #059669; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                    <span>➕ Open Google Meet to Create Room</span>
                  </button>
                  <span style="font-size: 10px; color: #047857;">(Opens meet.google.com/new in new tab)</span>
                </div>
                <div style="margin-top: 8px;">
                  <label style="font-weight: 700; font-size: 11px; color: #047857; display: block; margin-bottom: 4px;">
                    Paste Google Meet Link here (Required):
                  </label>
                  <input
                    type="text"
                    [(ngModel)]="googleMeetUrl"
                    (input)="meetUrlError = ''"
                    placeholder="https://meet.google.com/abc-defg-hij"
                    style="width: 100%; padding: 6px 10px; font-size: 12px; border: 1px solid #a7f3d0; border-radius: 6px; background: #ffffff;"
                  />
                  <div *ngIf="meetUrlError" style="color: #dc2626; font-size: 11px; margin-top: 4px; font-weight: 600;">
                    ⚠️ {{ meetUrlError }}
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
  interviewMode: 'portal' | 'zoom' | 'meet' = 'portal';
  googleMeetUrl: string = '';
  meetUrlError: string = '';
  isZoomSchedule: boolean = false;

  @Output() dismiss = new EventEmitter<void>();
  @Output() save = new EventEmitter<StudentTimetablePayload>();
  @Output() delete = new EventEmitter<void>();

  openGoogleMeetNew() {
    window.open('https://meet.google.com/new', '_blank');
  }

  onDismiss() {
    this.meetUrlError = '';
    this.dismiss.emit();
  }

  onSave() {
    this.meetUrlError = '';
    if (this.interviewMode === 'meet') {
      const url = (this.googleMeetUrl || '').trim();
      if (!url) {
        this.meetUrlError = 'Google Meet link paste karna zaroori hai. Upar diye button par click karke link banayein!';
        return;
      }
      if (!url.includes('meet.google.com/')) {
        this.meetUrlError = 'Valid Google Meet link daalein (e.g. https://meet.google.com/abc-defg-hij)';
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
      googleMeetUrl: this.googleMeetUrl.trim()
    });
  }

  onDelete() {
    this.delete.emit();
  }
}
