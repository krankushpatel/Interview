import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, OnInit, OnChanges, SimpleChanges, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Question } from '../../../services/admin.service';
import { environment } from '../../../../environments/environment';   // ✅ NEW

export interface AddQuestionData {
  question: string;
  category: string;
  difficulty: string;
  keywords?: string;
  image?: File;
  hideFromStudent?: boolean;          // ✅ NEW
  sendTextOnlyToAi?: boolean;         // ✅ NEW
}

@Component({
  selector: 'app-admin-questions',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../admin.page.scss'],
  template: `
    <div class="view active">
      <div class="page-header">
        <div>
          <h1 class="page-title">Question Bank</h1>
          <p class="page-subtitle">Manage interview questions across all categories with Deepgram speech keywords</p>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="btn btn-outline" (click)="backfillKeywords.emit()" title="Auto-extract speech recognition keywords for any questions missing them" style="font-size: 13px; padding: 6px 12px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
              <path d="M16 21h5v-5"/>
            </svg>
            Auto-Sync Keywords
          </button>
          <span class="stat-chip">{{ totalQuestions }} questions</span>
        </div>
      </div>

      <!-- Add New Question Card -->
      <div class="add-question-card">
        <div class="aq-card-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add New Question
        </div>
        <div class="aq-form">
          <!-- ✅ Question Text field (YE ZAROORI HAI) -->
          <div class="aq-field aq-field-full">
            <label class="field-label">Question Text *</label>
            <textarea
              class="field-textarea"
              [(ngModel)]="newQuestionText"
              rows="3"
              placeholder="Enter your interview question..."
            ></textarea>
          </div>
          <div class="aq-field aq-field-full">
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

            <!-- ✅ Success preview -->
            <div *ngIf="selectedImage && !imageError" class="image-success-preview">
              <img [src]="imagePreviewUrl" alt="Preview" />
              <div class="image-info">
                <span class="image-name">{{ selectedImage.name }}</span>
                <span class="image-size">{{ (selectedImage.size / 1024).toFixed(1) }} KB</span>
              </div>
            </div>
          </div>
          <div class="aq-field">
            <label class="field-label">Category</label>
            <div class="custom-dropdown">
              <div class="dropdown-input-wrap">
                <input
                  type="text"
                  class="field-input"
                  [(ngModel)]="categorySearchText"
                  (input)="filterCategories()"
                  (focus)="openCategoryDropdown()"
                  placeholder="Search or select category..."
                  autocomplete="off"
                />
                <span class="dropdown-chevron" (click)="toggleCategoryDropdown()">▾</span>
              </div>
              <div class="dropdown-list" *ngIf="showCategoryDropdown">
                <div
                  *ngFor="let cat of filteredCategories"
                  class="dropdown-item"
                  (click)="selectCategory(cat)"
                >
                  {{ cat }}
                </div>
                <div
                  *ngIf="categorySearchText && !filteredCategories.includes(categorySearchText)"
                  class="dropdown-item dropdown-item-add"
                  (click)="addNewCategory()"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Add "{{ categorySearchText }}"
                </div>
                <div
                  *ngIf="filteredCategories.length === 0 && !categorySearchText"
                  class="dropdown-item dropdown-item-empty"
                >
                  No categories found
                </div>
              </div>
            </div>
          </div>
          <div class="aq-field">
            <label class="field-label">Difficulty</label>
            <select class="field-select" [(ngModel)]="newQuestionDifficulty">
              <option value="Easy">Easy</option>
              <option value="Medium">Medium</option>
              <option value="Hard">Hard</option>
            </select>
          </div>
          <div class="aq-field aq-field-full">
            <label class="field-label">Speech Keywords (Optional, comma-separated — auto-extracted if left blank)</label>
            <input
              type="text"
              class="field-input"
              [(ngModel)]="newQuestionKeywords"
              placeholder="e.g. PMOS, NMOS, CMOS, MOSFET, inverter"
            />
          </div>

           <!-- ✅ NEW: Hide from student checkbox -->
           <div class="aq-field aq-field-full">
             <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 12px; background: var(--bg-surface-2, #f9fafb); border: 1px solid var(--border, #e5e7eb); border-radius: 8px;">
               <input
                 type="checkbox"
                 [(ngModel)]="newQuestionHideFromStudent"
                 style="width: 18px; height: 18px; cursor: pointer; margin-top: 2px;"
               />
               <div style="flex: 1;">
                 <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                   <div style="font-weight: 600; font-size: 14px; color: var(--text-primary, #111827);">Hide question text from student</div>
                   <!-- ✅ NEW: Info icon -->
                   <button
                     type="button"
                     class="info-icon-btn"
                     (click)="$event.preventDefault(); $event.stopPropagation(); openCheckboxGuide();"
                     title="See how these checkboxes work"
                   >
                     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                       <circle cx="12" cy="12" r="10"/>
                       <line x1="12" y1="16" x2="12" y2="12"/>
                       <line x1="12" y1="8" x2="12.01" y2="8"/>
                     </svg>
                   </button>
                 </div>
                 <div style="font-size: 12px; color: var(--text-tertiary, #6b7280); margin-top: 3px;">
                   Students will only see the image. Text is used for AI evaluation only. <strong>Requires an image.</strong>
                 </div>
               </div>
             </label>
           </div>

           <!-- ✅ NEW: Send only text to AI checkbox -->
           <div class="aq-field aq-field-full">
             <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 12px; background: var(--bg-surface-2, #f9fafb); border: 1px solid var(--border, #e5e7eb); border-radius: 8px;">
               <input
                 type="checkbox"
                 [(ngModel)]="newQuestionSendTextOnly"
                 style="width: 18px; height: 18px; cursor: pointer; margin-top: 2px;"
               />
               <div style="flex: 1;">
                 <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                   <div style="font-weight: 600; font-size: 14px; color: var(--text-primary, #111827);">Send only text to AI (skip image)</div>
                   <!-- ✅ NEW: Info icon -->
                   <button
                     type="button"
                     class="info-icon-btn"
                     (click)="$event.preventDefault(); $event.stopPropagation(); openCheckboxGuide();"
                     title="See how these checkboxes work"
                   >
                     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                       <circle cx="12" cy="12" r="10"/>
                       <line x1="12" y1="16" x2="12" y2="12"/>
                       <line x1="12" y1="8" x2="12.01" y2="8"/>
                     </svg>
                   </button>
                 </div>
                 <div style="font-size: 12px; color: var(--text-tertiary, #6b7280); margin-top: 3px;">
                   Saves tokens. Use when question text is already inside the image.
                 </div>
               </div>
             </label>
           </div>

          <div class="aq-actions">
            <button class="btn btn-primary" (click)="onAddQuestion()">Add Question</button>
            <span class="aq-feedback success" *ngIf="addFeedback && addFeedbackType === 'success'">✓ {{ addFeedback }}</span>
            <span class="aq-feedback error" *ngIf="addFeedback && addFeedbackType === 'error'">✗ {{ addFeedback }}</span>
          </div>
        </div>
      </div>

      <!-- Filter Bar -->
      <div class="filter-bar">
        <div class="filter-chips">
          <span class="filter-label">Filters:</span>
          <select class="filter-chip-select" [(ngModel)]="questionFilterCategory" (change)="onFilterChange()">
            <option value="">All Categories</option>
            <option *ngFor="let cat of uniqueCategories" [value]="cat">{{ cat }}</option>
          </select>
          <select class="filter-chip-select" [(ngModel)]="filterDifficulty" (change)="onFilterChange()">
            <option value="">All Difficulties</option>
            <option value="Easy">🟢 Easy</option>
            <option value="Medium">🟡 Medium</option>
            <option value="Hard">🔴 Hard</option>
          </select>
          <button class="filter-reset-btn" *ngIf="questionFilterCategory || filterDifficulty" (click)="onResetFilters()">
            Reset ✕
          </button>
        </div>
      </div>

      <!-- Empty State -->
      <div *ngIf="paginatedQuestions.length === 0" class="empty-state-full">
        <div class="esf-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <div class="esf-title">No questions found</div>
        <div class="esf-sub">Adjust filters or add your first question above</div>
      </div>

      <!-- Questions Grid -->
      <div class="questions-grid" *ngIf="paginatedQuestions.length > 0">
        <div *ngFor="let q of paginatedQuestions; let i = index" class="q-card">
          <div class="q-card-header">
            <span class="q-id">#{{ (currentPage - 1) * pageSize + (i + 1) }}</span>
            <div class="q-chips">
              <span class="chip chip-cat">{{ q.category || 'General' }}</span>
              <span
                class="chip"
                [class.chip-easy]="q.difficulty === 'Easy'"
                [class.chip-medium]="q.difficulty === 'Medium'"
                [class.chip-hard]="q.difficulty === 'Hard'"
              >
                {{ q.difficulty }}
              </span>
            </div>
            <div class="q-actions">
              <button class="q-action-btn" (click)="editQuestion.emit(q)" title="Edit">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button class="q-action-btn q-action-delete" (click)="deleteQuestion.emit(q.id)" title="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="q-text">{{ q.question }}</div>

          <!-- ✅ NEW: Sirf ek chhota Image button — thumbnail nahi -->
          <div *ngIf="q.image" style="margin-top: 10px;">
            <button
              class="image-btn"
              (click)="openImagePreview(q.image)"
              title="View attached image"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              Image
            </button>
          </div>

          <div *ngIf="q.keywords && q.keywords.length > 0" style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px;">
            <span *ngFor="let kw of q.keywords" style="font-size: 11px; padding: 2px 7px; border-radius: 4px; background: rgba(20, 122, 131, 0.1); color: var(--dip-brand-1, #147A83); border: 1px solid rgba(20, 122, 131, 0.25); font-weight: 500;">
              {{ kw }}
            </span>
          </div>
        </div>
      </div>

      <!-- Pagination Bar -->
      <div class="pagination-bar" *ngIf="totalPages > 0">
        <div class="pagination-info">
          Showing {{ (currentPage - 1) * pageSize + 1 }}–{{ displayedRangeEnd }} of {{ totalQuestions }}
        </div>
        <div class="pagination-controls">
          <button class="page-btn" (click)="goToPage.emit(currentPage - 1)" [disabled]="currentPage === 1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <ng-container *ngFor="let page of visiblePages">
            <button class="page-btn" [class.active]="page === currentPage" (click)="goToPage.emit(page)">
              {{ page }}
            </button>
          </ng-container>
          <button class="page-btn" (click)="goToPage.emit(currentPage + 1)" [disabled]="currentPage === totalPages">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
        <div class="page-size-wrap">
          Show
          <select class="page-size-select" [value]="pageSize" (change)="onPageSizeChange($any($event.target).value)">
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
          </select>
          per page
        </div>
      </div>
    </div>

    <!-- ✅ NEW: Image Preview Modal (Lightbox) -->
    <div class="image-modal-backdrop" *ngIf="previewImageUrl" (click)="closeImagePreview()">
      <div class="image-modal-content" (click)="$event.stopPropagation()">
        <button class="image-modal-close" (click)="closeImagePreview()" title="Close">✕</button>
        <img [src]="previewImageUrl" alt="Question Image" />
      </div>
    </div>

    <!-- ✅ NEW: Checkbox Guide Popup -->
    <div class="guide-modal-backdrop" *ngIf="showCheckboxGuide" (click)="closeCheckboxGuide()">
      <div class="guide-modal" (click)="$event.stopPropagation()">
        
        <!-- Header -->
        <div class="guide-header">
          <h3>📘 Checkbox Guide</h3>
          <button class="guide-close" (click)="closeCheckboxGuide()" title="Close">✕</button>
        </div>

        <!-- Body -->
        <div class="guide-body">
          
          <p class="guide-intro">
            These two checkboxes control how the question appears to students and what gets sent to the AI for evaluation.
          </p>

          <!-- Table: 4 Cases -->
          <table class="guide-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Hide Text</th>
                <th>Send Only Text</th>
                <th>Student Sees</th>
                <th>AI Gets</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td>☐</td>
                <td>☐</td>
                <td>Text + Image</td>
                <td>Text + Image</td>
              </tr>
              <tr class="highlight-row">
                <td>2</td>
                <td>☑</td>
                <td>☐</td>
                <td><strong>Image Only</strong></td>
                <td>Text + Image</td>
              </tr>
              <tr class="highlight-row">
                <td>3</td>
                <td>☐</td>
                <td>☑</td>
                <td>Text + Image</td>
                <td><strong>Text Only</strong></td>
              </tr>
              <tr class="highlight-row primary">
                <td>4</td>
                <td>☑</td>
                <td>☑</td>
                <td><strong>Image Only</strong></td>
                <td><strong>Text Only</strong></td>
              </tr>
            </tbody>
          </table>

          <!-- Quick Tip -->
          <div class="guide-tip">
             <strong>💡 Tip:</strong> Whether an image is sent to the AI is controlled ONLY by the <code>Send Only Text</code> checkbox. <code>Hide from Student</code> only affects the student display.
          </div>

        </div>
      </div>
    </div>
  `
})
export class AdminQuestionsComponent implements OnInit, OnChanges {
  constructor(private elementRef: ElementRef) {}

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.showCategoryDropdown) return;
    const clickedInside = this.elementRef.nativeElement.querySelector('.custom-dropdown')?.contains(event.target as Node);
    if (!clickedInside) {
      this.showCategoryDropdown = false;
    }
  }

  // ✅ NEW: ESC key to close image modal
  @HostListener('document:keydown.escape')
  onEscKey() {
    if (this.previewImageUrl) {
      this.closeImagePreview();
    }
    if (this.showCheckboxGuide) {
      this.closeCheckboxGuide();
    }
  }

  @Input() totalQuestions: number = 0;
  @Input() paginatedQuestions: Question[] = [];
  @Input() uniqueCategories: string[] = [];
  @Input() allCategories: string[] = [];
  @Input() currentPage: number = 1;
  @Input() pageSize: number = 50;
  @Input() totalPages: number = 1;
  @Input() displayedRangeEnd: number = 0;
  @Input() visiblePages: number[] = [];
  @Input() questionFilterCategory: string = '';
  @Input() filterDifficulty: string = '';
  @Input() addFeedback: string = '';
  @Input() addFeedbackType: 'success' | 'error' = 'success';

  @Output() addQuestion = new EventEmitter<AddQuestionData>();
  @Output() editQuestion = new EventEmitter<Question>();
  @Output() deleteQuestion = new EventEmitter<number>();
  @Output() backfillKeywords = new EventEmitter<void>();
  @Output() filterChange = new EventEmitter<{ category: string; difficulty: string }>();
  @Output() resetFilters = new EventEmitter<void>();
  @Output() goToPage = new EventEmitter<number>();
  @Output() changePageSize = new EventEmitter<number>();

  newQuestionText: string = '';
  newQuestionKeywords: string = '';
  selectedImage: File | null = null;
  imageError: string = '';
  imagePreviewUrl: string = '';
  newQuestionHideFromStudent: boolean = false;       // ✅ NEW
  newQuestionSendTextOnly: boolean = false;          // ✅ NEW
  categorySearchText: string = '';
  newQuestionDifficulty: string = 'Medium';
  showCategoryDropdown: boolean = false;
  filteredCategories: string[] = [];

  // ✅ NEW: Image preview state
  previewImageUrl: string | null = null;

  // ✅ NEW: Checkbox guide popup state
  showCheckboxGuide: boolean = false;

  ngOnInit() {
    this.filterCategories();
  }

  ngOnChanges(_changes: SimpleChanges) {
    this.filterCategories();
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

  getCombinedCategories(): string[] {
    const set = new Set<string>();
    (this.allCategories || []).forEach(c => c && set.add(c.trim()));
    (this.uniqueCategories || []).forEach(c => c && set.add(c.trim()));
    if (set.size === 0) set.add('General');
    return Array.from(set).sort();
  }

  filterCategories() {
    const list = this.getCombinedCategories();
    const q = (this.categorySearchText || '').toLowerCase().trim();
    this.filteredCategories = q ? list.filter(c => c.toLowerCase().includes(q)) : list;
  }

  

  // onImageSelected(event: any) {
  //   const file = event.target.files[0];
  //   if (file) {
  //     this.selectedImage = file;
  //   } else {
  //     this.selectedImage = null;
  //   }
  // }

  // ✅ UPDATED: Frontend validation (type, size, ratio)
  onImageSelected(event: any) {
    const file = event.target.files[0];
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

    // 2️⃣ File size check (5 MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      this.imageError = `File size exceeds 5 MB limit (yours: ${(file.size / (1024 * 1024)).toFixed(2)} MB).`;
      this.selectedImage = null;
      event.target.value = '';
      return;
    }

    // 3️⃣ Image ratio check (1:1 square with 10% tolerance — same as backend)
    const reader = new FileReader();
    reader.onload = (e: any) => {
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        const ratio = width / height;
        const targetRatio = 16 / 9;         // 1:1 (square)
        const tolerance = 0.1;             // 10% — backend ke saath match karo

        if (Math.abs(ratio - targetRatio) > tolerance) {
          this.imageError = `Image ratio must be approximately 16:9. Yours is ${width}×${height} (${ratio.toFixed(2)}:1).`;
          this.selectedImage = null;
          this.imagePreviewUrl = '';
          event.target.value = '';
        } else {
          // ✅ Valid image
          this.selectedImage = file;
          this.imagePreviewUrl = e.target.result;
          this.imageError = '';
        }
      };
      img.onerror = () => {
        this.imageError = 'Invalid image file. Please try another.';
        this.selectedImage = null;
        event.target.value = '';
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  selectCategory(cat: string) {
    this.categorySearchText = cat;
    this.showCategoryDropdown = false;
  }

  addNewCategory() {
    const val = (this.categorySearchText || '').trim();
    if (val) {
      if (!this.allCategories.includes(val)) {
        this.allCategories.push(val);
      }
      this.filterCategories();
    }
    this.showCategoryDropdown = false;
  }

  onAddQuestion() {
    if (!this.newQuestionText.trim()) return;

    // ✅ Validation: Hide requires image
    if (this.newQuestionHideFromStudent && !this.selectedImage) {
      this.imageError = 'Cannot hide text without image. Please select an image first.';
      return;
    }

    const trimmed = this.newQuestionText.trim();
    this.addQuestion.emit({
      question: trimmed,
      category: this.categorySearchText.trim(),
      difficulty: this.newQuestionDifficulty,
      keywords: this.newQuestionKeywords.trim(),
      image: this.selectedImage || undefined,
      hideFromStudent: this.newQuestionHideFromStudent,        // ✅ NEW
      sendTextOnlyToAi: this.newQuestionSendTextOnly           // ✅ NEW
    });
    this.newQuestionText = '';
    this.newQuestionKeywords = '';
    this.selectedImage = null;
    this.imageError = '';
    this.imagePreviewUrl = '';
    this.newQuestionHideFromStudent = false;                   // ✅ NEW
    this.newQuestionSendTextOnly = false;                      // ✅ NEW
    const fileInput = this.elementRef.nativeElement.querySelector('input[type="file"]');
    if (fileInput) fileInput.value = '';
  }

  onFilterChange() {
    this.filterChange.emit({
      category: this.questionFilterCategory,
      difficulty: this.filterDifficulty
    });
  }

  onResetFilters() {
    this.questionFilterCategory = '';
    this.filterDifficulty = '';
    this.resetFilters.emit();
  }

  onPageSizeChange(size: string | number) {
    this.changePageSize.emit(Number(size));
  }

  // ✅ Image URL builder
  getImageUrl(filename: string): string {
    if (!filename) return '';
    return `${environment.apiUrl}/uploads/questions/${filename}`;
  }

  // ✅ NEW: Open image preview
  openImagePreview(filename: string) {
    if (!filename) return;
    this.previewImageUrl = this.getImageUrl(filename);
  }

  // ✅ NEW: Close image preview
  closeImagePreview() {
    this.previewImageUrl = null;
  }

    // ✅ NEW: Open checkbox guide popup
  openCheckboxGuide(): void {
    this.showCheckboxGuide = true;
  }

  // ✅ NEW: Close checkbox guide popup
  closeCheckboxGuide(): void {
    this.showCheckboxGuide = false;
  }
}