import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-create-group-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-modal class="auto-fit-modal" [isOpen]="isOpen" (ionModalDidDismiss)="onDismiss()">
      <ng-template>
        <div style="background: #ffffff; color: #1e293b; width: 100%; border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; font-family: inherit;">
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; border-bottom: 1px solid #e2e8f0;">
            <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #0f172a;">Create New Group</h2>
            <button style="background: none; border: none; font-size: 14px; font-weight: 600; color: #64748b; cursor: pointer;" (click)="onDismiss()">Cancel</button>
          </div>
          <div style="padding: 24px; display: flex; flex-direction: column; gap: 16px;">
            <div style="text-align: center; font-size: 36px; margin-bottom: 2px;">👥</div>
            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 6px; letter-spacing: 0.5px;">GROUP NAME *</label>
              <input
                type="text"
                [(ngModel)]="groupName"
                placeholder="e.g. Python Batch Jan 2026"
                autofocus
                style="width: 100%; padding: 12px 14px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #0f172a; font-size: 14px; outline: none; box-sizing: border-box;"
              />
            </div>
            <div style="font-size: 13px; color: #475569; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; line-height: 1.4;">
              An empty group will be created. You can add students from the group detail view.
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 12px; padding-top: 8px; border-top: 1px solid #e2e8f0; margin-top: 4px;">
              <button style="padding: 10px 18px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #334155; font-weight: 600; cursor: pointer;" (click)="onDismiss()">Cancel</button>
              <button
                style="padding: 10px 20px; border-radius: 8px; border: none; background: #2563eb; color: #ffffff; font-weight: 600; cursor: pointer;"
                [disabled]="!groupName || !groupName.trim()"
                [style.opacity]="(!groupName || !groupName.trim()) ? '0.5' : '1'"
                (click)="onCreate()"
              >
                ✅ Create Group
              </button>
            </div>
          </div>
        </div>
      </ng-template>
    </ion-modal>
  `
})
export class CreateGroupModalComponent {
  @Input() isOpen: boolean = false;
  @Input() groupName: string = '';

  @Output() dismiss = new EventEmitter<void>();
  @Output() create = new EventEmitter<string>();

  onDismiss() {
    this.dismiss.emit();
  }

  onCreate() {
    if (this.groupName && this.groupName.trim()) {
      this.create.emit(this.groupName.trim());
    }
  }
}
