import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

export interface EditQuestionPayload {
  text: string;
  category: string;
  difficulty: string;
}

@Component({
  selector: 'app-edit-question-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-modal class="auto-fit-modal" [isOpen]="isOpen" (ionModalDidDismiss)="onDismiss()">
      <ng-template>
        <div style="background: var(--dip-surface, #ffffff); width: 100%; border-radius: 16px; overflow: hidden; display: flex; flex-direction: column;">
          <ion-header class="ion-no-border">
            <ion-toolbar class="modal-toolbar">
              <ion-title>Edit Question</ion-title>
            </ion-toolbar>
          </ion-header>
          <div class="modal-body">
            <div class="modal-field">
              <label class="field-label">Question Text *</label>
              <textarea [(ngModel)]="text" rows="4" class="field-textarea" placeholder="Enter question text..."></textarea>
            </div>
            <div class="modal-field">
              <label class="field-label">Category</label>
              <div class="custom-dropdown">
                <div class="dropdown-input-wrap">
                  <input
                    type="text"
                    class="field-input"
                    [(ngModel)]="category"
                    (input)="filterCategories()"
                    (focus)="showCategoryDropdown = true; filterCategories()"
                    placeholder="Search or select category..."
                    autocomplete="off"
                  />
                  <span class="dropdown-chevron" (click)="showCategoryDropdown = !showCategoryDropdown">▾</span>
                </div>
                <div class="dropdown-list" *ngIf="showCategoryDropdown">
                  <div *ngFor="let cat of filteredCategories" class="dropdown-item" (click)="selectCategory(cat)">
                    {{ cat }}
                  </div>
                  <div
                    *ngIf="category && !filteredCategories.includes(category)"
                    class="dropdown-item dropdown-item-add"
                    (click)="addNewCategory()"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Add "{{ category }}"
                  </div>
                  <div *ngIf="filteredCategories.length === 0 && !category" class="dropdown-item dropdown-item-empty">
                    No categories found
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-field">
              <label class="field-label">Difficulty</label>
              <select [(ngModel)]="difficulty" class="field-select">
                <option value="Easy">🟢 Easy</option>
                <option value="Medium">🟡 Medium</option>
                <option value="Hard">🔴 Hard</option>
              </select>
            </div>
            <div class="modal-actions">
              <button class="btn btn-ghost" (click)="onDismiss()">Cancel</button>
              <button class="btn btn-primary" (click)="onSave()" [disabled]="!text">Save Changes</button>
            </div>
          </div>
        </div>
      </ng-template>
    </ion-modal>
  `
})
export class EditQuestionModalComponent {
  @Input() isOpen: boolean = false;
  @Input() text: string = '';
  @Input() category: string = '';
  @Input() difficulty: string = 'Medium';
  @Input() allCategories: string[] = [];

  @Output() dismiss = new EventEmitter<void>();
  @Output() save = new EventEmitter<EditQuestionPayload>();

  showCategoryDropdown: boolean = false;
  filteredCategories: string[] = [];

  filterCategories() {
    const q = (this.category || '').toLowerCase();
    this.filteredCategories = this.allCategories.filter(c => c.toLowerCase().includes(q));
  }

  selectCategory(cat: string) {
    this.category = cat;
    this.showCategoryDropdown = false;
  }

  addNewCategory() {
    if (this.category && !this.allCategories.includes(this.category)) {
      this.allCategories.push(this.category);
    }
    this.showCategoryDropdown = false;
  }

  onDismiss() {
    this.dismiss.emit();
  }

  onSave() {
    this.save.emit({
      text: this.text,
      category: this.category,
      difficulty: this.difficulty
    });
  }
}
