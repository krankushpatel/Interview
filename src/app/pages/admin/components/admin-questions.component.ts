import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Question } from '../../../services/admin.service';

export interface AddQuestionData {
  question?: string;
  text: string;
  category: string;
  difficulty: string;
  keywords?: string;
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
          <div class="aq-field aq-field-full">
            <label class="field-label">Question Text *</label>
            <textarea
              class="field-textarea"
              [(ngModel)]="newQuestionText"
              rows="3"
              placeholder="Enter your interview question..."
            ></textarea>
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
                  (focus)="showCategoryDropdown = true; filterCategories()"
                  placeholder="Search or select category..."
                  autocomplete="off"
                />
                <span class="dropdown-chevron" (click)="showCategoryDropdown = !showCategoryDropdown">▾</span>
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
          <div class="q-text">{{ q.question || q.text }}</div>
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
  `
})
export class AdminQuestionsComponent {
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
  categorySearchText: string = '';
  newQuestionDifficulty: string = 'Medium';
  showCategoryDropdown: boolean = false;
  filteredCategories: string[] = [];

  filterCategories() {
    const q = (this.categorySearchText || '').toLowerCase();
    this.filteredCategories = this.allCategories.filter(c => c.toLowerCase().includes(q));
  }

  selectCategory(cat: string) {
    this.categorySearchText = cat;
    this.showCategoryDropdown = false;
  }

  addNewCategory() {
    if (this.categorySearchText && !this.allCategories.includes(this.categorySearchText)) {
      this.allCategories.push(this.categorySearchText);
    }
    this.showCategoryDropdown = false;
  }

  onAddQuestion() {
    if (!this.newQuestionText.trim()) return;
    const trimmed = this.newQuestionText.trim();
    this.addQuestion.emit({
      question: trimmed,
      text: trimmed,
      category: this.categorySearchText.trim(),
      difficulty: this.newQuestionDifficulty,
      keywords: this.newQuestionKeywords.trim()
    });
    this.newQuestionText = '';
    this.newQuestionKeywords = '';
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
}
