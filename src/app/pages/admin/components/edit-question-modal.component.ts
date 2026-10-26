import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, OnInit, OnChanges, SimpleChanges, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

export interface EditQuestionPayload {
  question: string;
  category: string;
  difficulty: string;
  keywords?: string;
  image?: File | null;
  removeImage?: boolean;
  hideFromStudent?: boolean;          // ✅ NEW
  sendTextOnlyToAi?: boolean;         // ✅ NEW
}

@Component({
  selector: 'app-edit-question-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../admin.page.scss'],
  template: `
    <ion-modal class="auto-fit-modal" [isOpen]="isOpen" (ionModalDidDismiss)="onDismiss()">
      <ng-template>
        <div style="background: var(--dip-surface, #ffffff); width: 100%; height: 100%; border-radius: 16px; overflow: hidden; display: flex; flex-direction: column;">
          <!-- ✅ FIX: height: 100% added above -->
          <ion-header class="ion-no-border" style="flex-shrink: 0;">
            <!-- ✅ FIX: flex-shrink: 0 added above -->
            <ion-toolbar class="modal-toolbar">
              <ion-title>Edit Question</ion-title>
            </ion-toolbar>
          </ion-header>
          <div class="modal-body" style="flex: 1; min-height: 0;">
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
                    (focus)="openCategoryDropdown()"
                    placeholder="Search or select category..."
                    autocomplete="off"
                  />
                  <span class="dropdown-chevron" (click)="toggleCategoryDropdown()">▾</span>
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
            <div class="modal-field">
              <label class="field-label">Keywords (comma-separated for Deepgram)</label>
              <input type="text" [(ngModel)]="keywords" class="field-input" placeholder="e.g. PMOS, NMOS, CMOS, MOSFET" />
            </div>

            <!-- ✅ Image field with frontend validation -->
            <div class="modal-field">
              <label class="field-label">Question Image (Square, 16:9 ratio, max 5 MB)</label>
              <input
                type="file"
                class="field-input"
                (change)="onImageSelected($event)"
                accept=".jpg, .jpeg, .png"
              />

              <!-- ✅ Error message -->
              <div *ngIf="imageError" class="image-error-msg">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {{ imageError }}
              </div>

              <!-- ✅ New image preview -->
              <div *ngIf="selectedImage && !imageError" class="image-success-preview">
                <img [src]="imagePreviewUrl" alt="Preview" />
                <div class="image-info">
                  <span class="image-name">{{ selectedImage.name }}</span>
                  <span class="image-size">{{ (selectedImage.size / 1024).toFixed(1) }} KB</span>
                </div>
              </div>

              <!-- ✅ Existing image (agar naya select nahi kiya) -->
              <div *ngIf="existingImage && !selectedImage && !removeExisting" class="image-preview" style="margin-top:6px; font-size:12px; color: #666; display: flex; align-items: center; gap: 8px;">
                <span>Current: {{ existingImage }}</span>
                <button
                  type="button"
                  class="btn btn-ghost"
                  style="padding:2px 8px; font-size:11px;"
                  (click)="removeExistingImage()"
                >Remove</button>
              </div>
              <div *ngIf="removeExisting" style="margin-top:6px; font-size:12px; color: #c0392b;">
                Existing image will be removed on save.
              </div>
            </div>

            <!-- ✅ NEW: Hide from student checkbox -->
            <div class="modal-field">
              <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 12px; background: var(--bg-surface-2, #f9fafb); border: 1px solid var(--border, #e5e7eb); border-radius: 8px;">
                <input
                  type="checkbox"
                  [(ngModel)]="hideFromStudent"
                  style="width: 18px; height: 18px; cursor: pointer; margin-top: 2px;"
                />
                <div>
                  <div style="font-weight: 600; font-size: 14px; color: var(--text-primary, #111827);">Hide question text from student</div>
                  <div style="font-size: 12px; color: var(--text-tertiary, #6b7280); margin-top: 3px;">
                    Students will only see the image. Text is used for AI evaluation only.
                  </div>
                </div>
              </label>
            </div>

            <!-- ✅ NEW: Send only text to AI checkbox -->
            <div class="modal-field">
              <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 12px; background: var(--bg-surface-2, #f9fafb); border: 1px solid var(--border, #e5e7eb); border-radius: 8px;">
                <input
                  type="checkbox"
                  [(ngModel)]="sendTextOnlyToAi"
                  style="width: 18px; height: 18px; cursor: pointer; margin-top: 2px;"
                />
                <div>
                  <div style="font-weight: 600; font-size: 14px; color: var(--text-primary, #111827);">Send only text to AI (skip image)</div>
                  <div style="font-size: 12px; color: var(--text-tertiary, #6b7280); margin-top: 3px;">
                    Saves tokens. Use when question text is already inside the image.
                  </div>
                </div>
              </label>
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
export class EditQuestionModalComponent implements OnInit, OnChanges {
  constructor(private elementRef: ElementRef) { }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.showCategoryDropdown) return;
    const clickedInside = this.elementRef.nativeElement.querySelector('.custom-dropdown')?.contains(event.target as Node);
    if (!clickedInside) {
      this.showCategoryDropdown = false;
    }
  }

  @Input() isOpen: boolean = false;
  @Input() text: string = '';
  @Input() category: string = '';
  @Input() difficulty: string = 'Medium';
  @Input() keywords: string = '';
  @Input() allCategories: string[] = [];
  @Input() existingImage: string | null = null;
  @Input() hideFromStudent: boolean = false;        // ✅ NEW
  @Input() sendTextOnlyToAi: boolean = false;       // ✅ NEW  // ✅ NEW: current image filename (from question object)

  @Output() dismiss = new EventEmitter<void>();
  @Output() save = new EventEmitter<EditQuestionPayload>();

  showCategoryDropdown: boolean = false;
  filteredCategories: string[] = [];

  // ✅ NEW: image state
  selectedImage: File | null = null;
  removeExisting: boolean = false;
  imageError: string = '';
  imagePreviewUrl: string = '';

  ngOnInit() {
    this.filterCategories();
  }

  ngOnChanges(_changes: SimpleChanges) {
    this.filterCategories();
    // Reset image state whenever modal inputs change (naya question edit ke liye open ho raha hai)
    // Note: modal open hone par parent naya existingImage set karega
    if (!this.isOpen) {
      this.selectedImage = null;
      this.removeExisting = false;
    }
  }

  openCategoryDropdown() {
    this.showCategoryDropdown = true;
    this.filterCategories();
  }

  toggleCategoryDropdown() {
    this.showCategoryDropdown = !this.showCategoryDropdown;
    if (this.showCategoryDropdown) {
      this.filterCategories();
    }
  }

  filterCategories() {
    const list = (this.allCategories && this.allCategories.length > 0) ? this.allCategories : ['General'];
    const q = (this.category || '').toLowerCase().trim();
    this.filteredCategories = q ? list.filter(c => c.toLowerCase().includes(q)) : list;
  }

  selectCategory(cat: string) {
    this.category = cat;
    this.showCategoryDropdown = false;
  }

  addNewCategory() {
    const val = (this.category || '').trim();
    if (val) {
      if (!this.allCategories.includes(val)) {
        this.allCategories.push(val);
      }
      this.filterCategories();
    }
    this.showCategoryDropdown = false;
  }

  // ✅ NEW: image select handler
  // onImageSelected(event: any) {
  //   const file = event.target.files && event.target.files[0];
  //   if (file) {
  //     this.selectedImage = file;
  //     // Agar naya image select kiya toh "remove existing" cancel ho jata hai
  //     this.removeExisting = false;
  //   } else {
  //     this.selectedImage = null;
  //   }
  // }

  // ✅ UPDATED: Frontend validation (type, size, ratio)
  onImageSelected(event: any) {
    const file = event.target.files && event.target.files[0];
    this.imageError = '';
    this.imagePreviewUrl = '';

    if (!file) {
      this.selectedImage = null;
      return;
    }

    // 1️⃣ File type check
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      this.imageError = 'Only JPG and PNG images are allowed.';
      this.selectedImage = null;
      event.target.value = '';
      return;
    }

    // 2️⃣ File size check
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      this.imageError = `File size exceeds 5 MB limit.`;
      this.selectedImage = null;
      event.target.value = '';
      return;
    }

    // 3️⃣ Ratio check
    const reader = new FileReader();
    reader.onload = (e: any) => {
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        const ratio = width / height;
        const targetRatio = 16 / 9;
        const tolerance = 0.1;

        if (Math.abs(ratio - targetRatio) > tolerance) {
          this.imageError = `Image ratio must be ~16:9 . Yours is ${width}×${height} (${ratio.toFixed(2)}:1).`;
          this.selectedImage = null;
          this.imagePreviewUrl = '';
          event.target.value = '';
        } else {
          this.selectedImage = file;
          this.imagePreviewUrl = e.target.result;
          this.removeExisting = false;
          this.imageError = '';
        }
      };
      img.onerror = () => {
        this.imageError = 'Invalid image file.';
        this.selectedImage = null;
        event.target.value = '';
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ✅ NEW: existing image remove toggle
  removeExistingImage() {
    this.removeExisting = true;
    this.selectedImage = null;
  }

  onDismiss() {
    // reset image state
    this.selectedImage = null;
    this.removeExisting = false;
    this.imageError = '';              // ✅ NEW
    this.imagePreviewUrl = '';
    this.dismiss.emit();
  }

  onSave() {
    // ✅ Safety: agar image error hai toh save nahi hone do
    if (this.imageError) {
      return;
    }
    // ✅ Validation: Hide requires image (existing or new)
    if (this.hideFromStudent && !this.selectedImage && !this.existingImage) {
      this.imageError = 'Cannot hide text without image. Please select an image.';
      return;
    }
    this.save.emit({
      question: this.text,
      category: this.category,
      difficulty: this.difficulty,
      keywords: this.keywords,
      image: this.selectedImage,
      removeImage: this.removeExisting,
      hideFromStudent: this.hideFromStudent,          // ✅ NEW
      sendTextOnlyToAi: this.sendTextOnlyToAi         // ✅ NEW
    });
    this.selectedImage = null;
    this.removeExisting = false;
    this.imageError = '';
    this.imagePreviewUrl = '';
  }
}