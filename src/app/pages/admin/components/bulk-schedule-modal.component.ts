import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

export interface BulkSchedulePayload {
  bulkScheduleStart: string;
  bulkScheduleEnd: string;
  bulkScheduleTopics: string;
  bulkScheduleSendEmail: boolean;
}

@Component({
  selector: 'app-bulk-schedule-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-modal [isOpen]="isOpen" (ionModalDidDismiss)="onDismiss()">
      <ng-template>
        <ion-header>
          <ion-toolbar class="modal-toolbar">
            <ion-title>📅 Schedule {{ selectedCount }} Students</ion-title>
            <ion-buttons slot="end">
              <ion-button (click)="onDismiss()">Cancel</ion-button>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>
        <ion-content class="modal-content">
          <div class="modal-body">
            <div class="modal-field">
              <label class="field-label">Start Date & Time *</label>
              <input type="datetime-local" class="field-input" [(ngModel)]="bulkScheduleStart" [min]="minDateTime" />
            </div>
            <div class="modal-field">
              <label class="field-label">End Date & Time *</label>
              <input type="datetime-local" class="field-input" [(ngModel)]="bulkScheduleEnd" [min]="bulkScheduleStart" />
            </div>
            <div class="modal-field">
              <label class="field-label">Topics</label>
              <ion-input [(ngModel)]="bulkScheduleTopics" class="modal-input" placeholder="Python, OOP"></ion-input>
            </div>
            <div class="modal-field">
              <label class="toggle-wrap">
                <input type="checkbox" [(ngModel)]="bulkScheduleSendEmail" />
                <span class="toggle-slider"></span>
                <span class="toggle-label">Send email notification</span>
              </label>
            </div>
            <button
              class="btn btn-primary"
              style="width:100%;margin-top:1rem"
              (click)="onApply()"
              [disabled]="!bulkScheduleStart || !bulkScheduleEnd"
            >
              Apply Schedule
            </button>
          </div>
        </ion-content>
      </ng-template>
    </ion-modal>
  `
})
export class BulkScheduleModalComponent {
  @Input() isOpen: boolean = false;
  @Input() selectedCount: number = 0;
  @Input() minDateTime: string = '';
  @Input() bulkScheduleStart: string = '';
  @Input() bulkScheduleEnd: string = '';
  @Input() bulkScheduleTopics: string = '';
  @Input() bulkScheduleSendEmail: boolean = true;

  @Output() dismiss = new EventEmitter<void>();
  @Output() apply = new EventEmitter<BulkSchedulePayload>();

  onDismiss() {
    this.dismiss.emit();
  }

  onApply() {
    this.apply.emit({
      bulkScheduleStart: this.bulkScheduleStart,
      bulkScheduleEnd: this.bulkScheduleEnd,
      bulkScheduleTopics: this.bulkScheduleTopics,
      bulkScheduleSendEmail: this.bulkScheduleSendEmail
    });
  }
}
