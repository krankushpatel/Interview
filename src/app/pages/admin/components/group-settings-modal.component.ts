import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

export interface TopicDistributionRow {
  topic: string;
  l1: number;
  l2: number;
  l3: number;
}

export interface GroupSettingsData {
  selectedClasses: string[];
  selectedCategories: string[];
  allowTyping: boolean;
  topicDistribution: TopicDistributionRow[];
}

@Component({
  selector: 'app-group-settings-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-modal class="auto-fit-modal" [isOpen]="isOpen" (ionModalDidDismiss)="onDismiss()">
      <ng-template>
        <div style="background: var(--dip-surface, #ffffff); width: 100%; border-radius: 16px; overflow: hidden; display: flex; flex-direction: column;">
          <!-- Header -->
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: 1px solid var(--dip-border);">
            <h2 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--dip-text-primary);">
              ⚙️ Group Settings: {{ groupName }}
            </h2>
            <button
              style="background: none; border: none; font-size: 14px; font-weight: 600; color: var(--dip-text-secondary); cursor: pointer;"
              (click)="onDismiss()"
            >
              ✕ Close
            </button>
          </div>

          <!-- Body Content -->
          <div class="modal-body" style="overflow-y: auto; max-height: 80vh; padding: 24px;">
            <!-- SECTION 1: Scope Selection -->
            <div style="margin-bottom: 24px;">
              <label style="display: block; font-size: 13px; font-weight: 800; color: var(--dip-text-primary); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em;">
                1. Topic-Wise Question Distribution
              </label>
              <!-- Class Selection Row -->
              <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 16px;">
                <select
                  [(ngModel)]="pendingClass"
                  style="flex: 1; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--dip-border); background: var(--dip-surface); color: var(--dip-text-primary); font-weight: 600; outline: none; cursor: pointer;"
                >
                  <option value="" disabled hidden>Choose Class...</option>
                  <option *ngFor="let cls of allClasses" [value]="cls">{{ cls }}</option>
                </select>
                <button
                  (click)="onAddClass()"
                  [disabled]="!pendingClass"
                  style="background: var(--dip-brand-1); color: white; border: none; padding: 10px 16px; border-radius: 8px; font-weight: 700; cursor: pointer; transition: 0.2s;"
                  [style.opacity]="!pendingClass ? '0.5' : '1'"
                >
                  + Add Class
                </button>
              </div>

              <!-- Added Classes Chips -->
              <div
                *ngIf="groupSettings.selectedClasses.length > 0"
                style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; padding: 12px; background: var(--dip-bg-secondary); border-radius: 8px; border: 1px dashed var(--dip-border);"
              >
                <span
                  *ngFor="let cls of groupSettings.selectedClasses"
                  style="display: inline-flex; align-items: center; gap: 6px; background: var(--dip-surface); border: 1px solid var(--dip-border); padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 700; color: var(--dip-text-primary);"
                >
                  {{ cls }}
                  <button
                    (click)="onRemoveClass(cls)"
                    style="background: rgba(239,68,68,0.1); color: var(--dip-danger); border: none; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-weight: bold; font-size: 10px;"
                  >
                    ✕
                  </button>
                </span>
              </div>

              <!-- Categories -->
              <div *ngIf="groupSettings.selectedClasses.length > 0">
                <label style="display: block; font-size: 12px; font-weight: 700; color: var(--dip-text-secondary); margin-bottom: 10px;">
                  Select Categories for the above classes:
                </label>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                  <span
                    *ngFor="let cat of availableCategories"
                    (click)="onToggleCategory(cat)"
                    [style.background]="groupSettings.selectedCategories.includes(cat) ? 'var(--dip-brand-1)' : 'var(--dip-surface)'"
                    [style.color]="groupSettings.selectedCategories.includes(cat) ? '#ffffff' : 'var(--dip-text-primary)'"
                    [style.borderColor]="groupSettings.selectedCategories.includes(cat) ? 'var(--dip-brand-1)' : 'var(--dip-border)'"
                    style="cursor: pointer; border: 1px solid; font-weight: 600; padding: 8px 16px; border-radius: 8px; transition: 0.2s; font-size: 13px;"
                  >
                    {{ groupSettings.selectedCategories.includes(cat) ? '☑' : '☐' }} {{ cat }}
                  </span>
                  <div
                    *ngIf="availableCategories.length === 0"
                    style="font-size: 13px; color: var(--dip-text-secondary); font-style: italic;"
                  >
                    No categories found.
                  </div>
                </div>
              </div>
            </div>

            <hr style="border: 0; border-top: 1px dashed var(--dip-border); margin: 24px 0;">

            <!-- SECTION 2: Exam Rules & Question Quantity -->
            <div>
              <label style="display: block; font-size: 13px; font-weight: 800; color: var(--dip-text-primary); margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.05em;">
                2. Exam Rules & Question Quantity
              </label>

              <!-- Typing Toggle -->
              <div style="margin-bottom: 20px; display: flex; align-items: center; gap: 12px; background: var(--dip-bg-secondary); padding: 12px 16px; border-radius: 8px;">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                  <input
                    type="checkbox"
                    [(ngModel)]="groupSettings.allowTyping"
                    style="width: 18px; height: 18px; accent-color: var(--dip-brand-1);"
                  />
                  <span style="font-weight: 700; font-size: 14px; color: var(--dip-text-primary);">Enable Keyboard Typing</span>
                </label>
                <span style="font-size: 12px; color: var(--dip-text-secondary);">(Disable to force Voice-only answers)</span>
              </div>

              <!-- Dynamic Rows -->
              <div *ngIf="groupSettings.topicDistribution.length > 0" style="display: flex; flex-direction: column; gap: 12px;">
                <div
                  *ngFor="let row of groupSettings.topicDistribution"
                  style="display: flex; justify-content: space-between; align-items: center; background: var(--dip-surface); padding: 12px 16px; border-radius: 8px; border: 1px solid var(--dip-border);"
                >
                  <div style="flex: 1; font-size: 14px; font-weight: 800; color: var(--dip-brand-1);">
                    {{ row.topic }}
                  </div>
                  <div style="display: flex; align-items: center; gap: 16px;">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;" title="Level 1 (Easy)">
                      <span style="font-size: 11px; font-weight: 800; color: #10B981;">L1</span>
                      <input
                        type="number"
                        [(ngModel)]="row.l1"
                        style="width: 45px; padding: 6px; text-align: center; border-radius: 6px; border: 1px solid var(--dip-border); font-weight: 800; outline: none; font-size: 13px;"
                        min="0"
                      />
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;" title="Level 2 (Medium)">
                      <span style="font-size: 11px; font-weight: 800; color: #F59E0B;">L2</span>
                      <input
                        type="number"
                        [(ngModel)]="row.l2"
                        style="width: 45px; padding: 6px; text-align: center; border-radius: 6px; border: 1px solid var(--dip-border); font-weight: 800; outline: none; font-size: 13px;"
                        min="0"
                      />
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;" title="Level 3 (Hard)">
                      <span style="font-size: 11px; font-weight: 800; color: #EF4444;">L3</span>
                      <input
                        type="number"
                        [(ngModel)]="row.l3"
                        style="width: 45px; padding: 6px; text-align: center; border-radius: 6px; border: 1px solid var(--dip-border); font-weight: 800; outline: none; font-size: 13px;"
                        min="0"
                      />
                    </div>
                  </div>
                </div>

                <!-- Total Questions Badge -->
                <div style="margin-top: 8px; display: flex; justify-content: flex-end; align-items: center; padding: 8px 16px; border-radius: 8px;">
                  <span style="font-size: 13px; font-weight: 700; color: var(--dip-text-secondary); margin-right: 12px;">Total Questions Selected:</span>
                  <span style="font-size: 20px; font-weight: 900; color: var(--dip-text-primary);">{{ getTopicQuestionsSum() }}</span>
                </div>
              </div>

              <div
                *ngIf="groupSettings.topicDistribution.length === 0"
                style="padding: 20px; background: var(--dip-bg-secondary); border-radius: 8px; font-size: 13px; font-weight: 600; color: var(--dip-text-secondary); text-align: center; border: 1px dashed var(--dip-border);"
              >
                Please select at least one Category above to set L1, L2, L3 quantities.
              </div>
            </div>

            <!-- Actions -->
            <div class="modal-actions" style="margin-top: 24px; display: flex; justify-content: flex-end; gap: 12px; border-top: 1px solid var(--dip-border); padding-top: 16px;">
              <button
                class="btn btn-ghost"
                style="padding: 10px 20px; font-weight: 600; color: var(--dip-text-secondary); background: transparent; border: none; cursor: pointer;"
                (click)="onDismiss()"
              >
                Cancel
              </button>
              <button
                class="btn btn-primary"
                style="padding: 10px 20px; font-weight: 600; background: var(--dip-brand-1); color: white; border: none; border-radius: 8px; cursor: pointer;"
                (click)="onSave()"
              >
                💾 Save Settings
              </button>
            </div>
          </div>
        </div>
      </ng-template>
    </ion-modal>
  `
})
export class GroupSettingsModalComponent {
  @Input() isOpen: boolean = false;
  @Input() groupName: string = '';
  @Input() allClasses: string[] = [];
  @Input() availableCategories: string[] = [];
  @Input() groupSettings: GroupSettingsData = {
    selectedClasses: [],
    selectedCategories: [],
    allowTyping: true,
    topicDistribution: []
  };

  @Output() dismiss = new EventEmitter<void>();
  @Output() save = new EventEmitter<void>();
  @Output() addClass = new EventEmitter<string>();
  @Output() removeClass = new EventEmitter<string>();
  @Output() toggleCategory = new EventEmitter<string>();

  pendingClass: string = '';

  onDismiss() {
    this.dismiss.emit();
  }

  onSave() {
    this.save.emit();
  }

  onAddClass() {
    if (this.pendingClass) {
      this.addClass.emit(this.pendingClass);
      this.pendingClass = '';
    }
  }

  onRemoveClass(cls: string) {
    this.removeClass.emit(cls);
  }

  onToggleCategory(cat: string) {
    this.toggleCategory.emit(cat);
  }

  getTopicQuestionsSum(): number {
    return (this.groupSettings.topicDistribution || []).reduce(
      (sum, item) => sum + (Number(item.l1) || 0) + (Number(item.l2) || 0) + (Number(item.l3) || 0),
      0
    );
  }
}
