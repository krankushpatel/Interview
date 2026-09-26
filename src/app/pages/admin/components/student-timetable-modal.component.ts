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

  @Output() dismiss = new EventEmitter<void>();
  @Output() save = new EventEmitter<StudentTimetablePayload>();
  @Output() delete = new EventEmitter<void>();

  onDismiss() {
    this.dismiss.emit();
  }

  onSave() {
    this.save.emit({
      startDateOnly: this.startDateOnly,
      startTimeOnly: this.startTimeOnly,
      startAmPm: this.startAmPm,
      endDateOnly: this.endDateOnly,
      endTimeOnly: this.endTimeOnly,
      endAmPm: this.endAmPm,
      timetableTopics: this.timetableTopics
    });
  }

  onDelete() {
    this.delete.emit();
  }
}
