import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

export interface ImportResultData {
  total: number;
  created: number;
  failed: number;
  emails_sent?: number;
  emails_failed?: number;
}

@Component({
  selector: 'app-import-result-modal',
  standalone: true,
  imports: [CommonModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-modal class="auto-fit-modal" [isOpen]="isOpen" (ionModalDidDismiss)="onDismiss()">
      <ng-template>
        <div style="background: #ffffff; color: #1e293b; width: 100%; border-radius: 16px; overflow: hidden; display: flex; flex-direction: column;">
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: 1px solid #e2e8f0;">
            <h2 style="margin: 0; font-size: 18px; font-weight: 800; color: #0f172a;">Import Result</h2>
            <button style="background: none; border: none; font-size: 14px; font-weight: 700; color: #64748b; cursor: pointer;" (click)="onDismiss()">
              ✕ Close
            </button>
          </div>

          <div style="padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 16px;" *ngIf="result">
            <div style="font-size: 48px; line-height: 1; text-align: center;" [style.color]="result.created > 0 ? '#10b981' : '#ef4444'">
              <span *ngIf="result.created > 0">✅</span>
              <span *ngIf="result.created === 0">❌</span>
            </div>

            <div style="font-size: 20px; font-weight: 800; color: #0f172a; text-align: center;">
              {{ result.created > 0 ? 'Import Successful' : 'Import Failed' }}
            </div>

            <div style="display: flex; gap: 12px; width: 100%; justify-content: center; margin-top: 8px;">
              <div style="background: #f1f5f9; padding: 12px 16px; border-radius: 8px; text-align: center; flex: 1;">
                <div style="font-size: 24px; font-weight: 800; color: #334155;">{{ result.total }}</div>
                <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Total</div>
              </div>
              <div style="background: #ecfdf5; padding: 12px 16px; border-radius: 8px; text-align: center; flex: 1;">
                <div style="font-size: 24px; font-weight: 800; color: #10b981;">{{ result.created }}</div>
                <div style="font-size: 11px; font-weight: 700; color: #059669; text-transform: uppercase;">Created</div>
              </div>
              <div style="background: #fef2f2; padding: 12px 16px; border-radius: 8px; text-align: center; flex: 1;">
                <div style="font-size: 24px; font-weight: 800; color: #ef4444;">{{ result.failed }}</div>
                <div style="font-size: 11px; font-weight: 700; color: #dc2626; text-transform: uppercase;">Failed</div>
              </div>
            </div>

            <div
              style="width: 100%; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; text-align: center; color: #475569; font-size: 14px; font-weight: 600;"
              *ngIf="result.emails_sent !== undefined"
            >
              📧 Emails sent: <span style="color: #0f172a; font-weight: 800;">{{ result.emails_sent }}</span>
              <span *ngIf="result.emails_failed && result.emails_failed > 0" style="color: #ef4444; margin-left: 8px;">
                · {{ result.emails_failed }} failed
              </span>
            </div>

            <button
              class="btn btn-primary"
              style="width: 100%; margin-top: 12px; padding: 12px; border-radius: 8px; font-weight: 700; background: #2563eb; color: white; border: none; cursor: pointer;"
              (click)="onDismiss()"
            >
              Done
            </button>
          </div>
        </div>
      </ng-template>
    </ion-modal>
  `
})
export class ImportResultModalComponent {
  @Input() isOpen: boolean = false;
  @Input() result: ImportResultData | null = null;

  @Output() dismiss = new EventEmitter<void>();

  onDismiss() {
    this.dismiss.emit();
  }
}
