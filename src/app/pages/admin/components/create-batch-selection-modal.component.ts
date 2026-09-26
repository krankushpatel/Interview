import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-create-batch-selection-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-modal [isOpen]="isOpen" (ionModalDidDismiss)="onDismiss()">
      <ng-template>
        <div style="background: var(--dip-surface, #ffffff); width: 100%; height: 100%; display: flex; flex-direction: column; border-radius: 16px; overflow: hidden;">
          <ion-header class="ion-no-border">
            <ion-toolbar class="modal-toolbar">
              <ion-title>Create Group from Selection</ion-title>
              <ion-buttons slot="end">
                <ion-button (click)="onDismiss()">Cancel</ion-button>
              </ion-buttons>
            </ion-toolbar>
          </ion-header>
          <div style="padding: 24px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 16px;">
            <div style="text-align: center; font-size: 36px; margin-bottom: 8px;">👥</div>
            <div class="modal-field">
              <label class="field-label" style="color: var(--text-main, #333); font-weight: 600;">Group Name *</label>
              <input
                type="text"
                [(ngModel)]="groupName"
                class="field-input"
                placeholder="e.g. Python Batch Jan 2026"
                style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #ccc;"
              />
            </div>
            <div class="group-selection-preview" style="background: #f9f9f9; padding: 12px; border-radius: 8px;">
              <div class="gsp-label" style="font-weight: 500; margin-bottom: 6px;">
                {{ selectedStudents.length }} students selected:
              </div>
              <div class="gsp-chips" style="display: flex; flex-wrap: wrap; gap: 6px;">
                <span
                  class="gsp-chip"
                  *ngFor="let u of selectedStudents"
                  style="background: #e2e8f0; padding: 4px 8px; border-radius: 4px; font-size: 12px;"
                >
                  {{ getStudentDisplayName(u) }}
                </span>
              </div>
            </div>
            <div style="margin-top: auto; display: flex; justify-content: flex-end; gap: 12px;">
              <button class="btn btn-ghost" (click)="onDismiss()">Cancel</button>
              <button
                class="btn btn-primary"
                (click)="onCreate()"
                [disabled]="!groupName.trim() || selectedStudents.length < 1"
              >
                ✅ Create Group ({{ selectedStudents.length }})
              </button>
            </div>
          </div>
        </div>
      </ng-template>
    </ion-modal>
  `
})
export class CreateBatchSelectionModalComponent {
  @Input() isOpen: boolean = false;
  @Input() groupName: string = '';
  @Input() selectedStudents: string[] = [];
  @Input() studentNameMap: { [username: string]: string } = {};

  @Output() dismiss = new EventEmitter<void>();
  @Output() create = new EventEmitter<string>();

  onDismiss() {
    this.dismiss.emit();
  }

  onCreate() {
    if (this.groupName.trim() && this.selectedStudents.length > 0) {
      this.create.emit(this.groupName.trim());
    }
  }

  getStudentDisplayName(username: string): string {
    return this.studentNameMap[username] || username;
  }
}
