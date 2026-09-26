import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

export interface BulkEmailPayload {
  emailType: string;
  emailSubject: string;
  emailMessage: string;
}

@Component({
  selector: 'app-bulk-email-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../admin.page.scss'],
  template: `
    <ion-modal [isOpen]="isOpen" (ionModalDidDismiss)="onDismiss()">
      <ng-template>
        <ion-header>
          <ion-toolbar class="modal-toolbar">
            <ion-title>Send Bulk Email</ion-title>
            <ion-buttons slot="end">
              <ion-button (click)="onDismiss()">Cancel</ion-button>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>
        <ion-content class="modal-content">
          <div class="modal-body">
            <div class="modal-info-banner">
              <strong>{{ selectedCount }}</strong> students will receive this email
            </div>
            <div class="modal-field">
              <label class="field-label">Email Type</label>
              <ion-select [(ngModel)]="emailType" interface="popover" class="modal-select">
                <ion-select-option value="custom">Custom Message</ion-select-option>
                <ion-select-option value="credentials">Send Login Credentials</ion-select-option>
                <ion-select-option value="exam_reminder">Exam Reminder</ion-select-option>
              </ion-select>
            </div>
            <div class="modal-field" *ngIf="emailType === 'custom'">
              <label class="field-label">Subject</label>
              <ion-input [(ngModel)]="emailSubject" class="modal-input" placeholder="Email subject..."></ion-input>
            </div>
            <div class="modal-field" *ngIf="emailType === 'custom'">
              <label class="field-label">Message</label>
              <ion-textarea [(ngModel)]="emailMessage" rows="5" class="modal-textarea" placeholder="Your message..."></ion-textarea>
            </div>
            <div class="modal-actions">
              <button class="btn btn-ghost" (click)="onDismiss()">Cancel</button>
              <button class="btn btn-primary" (click)="onSend()" [disabled]="emailType === 'custom' && !emailMessage">
                Send Email
              </button>
            </div>
          </div>
        </ion-content>
      </ng-template>
    </ion-modal>
  `
})
export class BulkEmailModalComponent {
  @Input() isOpen: boolean = false;
  @Input() selectedCount: number = 0;
  @Input() emailType: string = 'custom';
  @Input() emailSubject: string = '';
  @Input() emailMessage: string = '';

  @Output() dismiss = new EventEmitter<void>();
  @Output() send = new EventEmitter<BulkEmailPayload>();

  onDismiss() {
    this.dismiss.emit();
  }

  onSend() {
    this.send.emit({
      emailType: this.emailType,
      emailSubject: this.emailSubject,
      emailMessage: this.emailMessage
    });
  }
}
