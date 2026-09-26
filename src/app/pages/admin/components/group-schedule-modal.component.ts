import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

export interface GroupSchedulePayload {
  groupStartDateOnly: string;
  groupStartTimeOnly: string;
  groupStartAmPm: string;
  groupEndDateOnly: string;
  groupEndTimeOnly: string;
  groupEndAmPm: string;
  groupScheduleMessage: string;
}

@Component({
  selector: 'app-group-schedule-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-modal class="auto-fit-modal" [isOpen]="isOpen" (ionModalDidDismiss)="onDismiss()">
      <ng-template>
        <div style="background: var(--dip-surface, #ffffff); width: 100%; border-radius: 16px; overflow: hidden; display: flex; flex-direction: column;">
          <ion-header class="ion-no-border">
            <ion-toolbar class="modal-toolbar">
              <ion-title>📅 Schedule Group: {{ groupName }}</ion-title>
              <ion-buttons slot="end">
                <ion-button (click)="onDismiss()">Close</ion-button>
              </ion-buttons>
            </ion-toolbar>
          </ion-header>
          <div class="modal-body" style="overflow-y: auto; max-height: 80vh;">
            <div class="modal-field">
              <label class="field-label">Start Date & Time</label>
              <div style="display: flex; gap: 8px;">
                <input type="date" class="field-input" [(ngModel)]="groupStartDateOnly" style="flex: 2;" [min]="minDateOnly" />
                <input type="time" class="field-input" [(ngModel)]="groupStartTimeOnly" style="flex: 1.5;" />
                <select class="field-select" [(ngModel)]="groupStartAmPm" style="flex: 1;">
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>
            <div class="modal-field">
              <label class="field-label">End Date & Time</label>
              <div style="display: flex; gap: 8px;">
                <input type="date" class="field-input" [(ngModel)]="groupEndDateOnly" style="flex: 2;" [min]="groupStartDateOnly" />
                <input type="time" class="field-input" [(ngModel)]="groupEndTimeOnly" style="flex: 1.5;" />
                <select class="field-select" [(ngModel)]="groupEndAmPm" style="flex: 1;">
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>
            <div class="modal-field">
              <label class="field-label">Message / Instructions (Optional)</label>
              <textarea
                class="field-textarea"
                [(ngModel)]="groupScheduleMessage"
                rows="3"
                placeholder="e.g. Prepare for Python & Data Structures interview..."
              ></textarea>
            </div>
            <div class="modal-actions">
              <button class="btn btn-ghost" (click)="onDismiss()" [disabled]="isLoading">Cancel</button>
              <button
                class="btn btn-primary"
                (click)="onApply()"
                [disabled]="isLoading"
                style="display: flex; align-items: center;"
              >
                <div
                  class="loading-spinner"
                  *ngIf="isLoading"
                  style="width:14px;height:14px;margin-right:8px;border-width:2px;border-color:rgba(255,255,255,.3);border-top-color:white"
                ></div>
                {{ isLoading ? 'Saving...' : '💾 Save Schedule' }}
              </button>
            </div>
          </div>
        </div>
      </ng-template>
    </ion-modal>
  `
})
export class GroupScheduleModalComponent {
  @Input() isOpen: boolean = false;
  @Input() groupName: string = '';
  @Input() minDateOnly: string = '';
  @Input() groupStartDateOnly: string = '';
  @Input() groupStartTimeOnly: string = '09:00';
  @Input() groupStartAmPm: string = 'AM';
  @Input() groupEndDateOnly: string = '';
  @Input() groupEndTimeOnly: string = '05:00';
  @Input() groupEndAmPm: string = 'PM';
  @Input() groupScheduleMessage: string = '';
  @Input() isLoading: boolean = false;

  @Output() dismiss = new EventEmitter<void>();
  @Output() apply = new EventEmitter<GroupSchedulePayload>();

  onDismiss() {
    this.dismiss.emit();
  }

  onApply() {
    this.apply.emit({
      groupStartDateOnly: this.groupStartDateOnly,
      groupStartTimeOnly: this.groupStartTimeOnly,
      groupStartAmPm: this.groupStartAmPm,
      groupEndDateOnly: this.groupEndDateOnly,
      groupEndTimeOnly: this.groupEndTimeOnly,
      groupEndAmPm: this.groupEndAmPm,
      groupScheduleMessage: this.groupScheduleMessage
    });
  }
}
