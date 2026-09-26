import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Submission, Student } from '../../../services/admin.service';

@Component({
  selector: 'app-admin-submissions',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="view active">
      <div class="page-header">
        <div>
          <h1 class="page-title">All Submissions</h1>
          <p class="page-subtitle">Every student answer in one place</p>
        </div>
        <span class="stat-chip">{{ filteredSubmissions.length }} results</span>
      </div>

      <div class="filter-bar">
        <div class="search-wrap flex-1">
          <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            class="search-input"
            type="text"
            placeholder="Search by student, question, answer…"
            [(ngModel)]="searchTerm"
            (input)="onFilterChange()"
          />
        </div>
        <select class="filter-select" [(ngModel)]="filterStudent" (change)="onFilterChange()">
          <option value="">All Students</option>
          <option *ngFor="let st of students" [value]="st.username">{{ st.name }}</option>
        </select>
        <select class="filter-select" [(ngModel)]="submissionFilterCategory" (change)="onFilterChange()">
          <option value="">All Categories</option>
          <option *ngFor="let opt of categoryOptions" [value]="opt.value">{{ opt.label }}</option>
        </select>
      </div>

      <div *ngIf="filteredSubmissions.length === 0" class="empty-state-full">
        <div class="esf-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        </div>
        <div class="esf-title">No submissions found</div>
        <div class="esf-sub">Try adjusting your filters or search query</div>
      </div>

      <div class="submissions-list" *ngIf="filteredSubmissions.length > 0">
        <div *ngFor="let s of filteredSubmissions" class="submission-card" (click)="openSubmission.emit(s)">
          <div class="sub-card-left">
            <div class="sub-avatar">{{ (s.student_name || s.username || '?')[0].toUpperCase() }}</div>
          </div>
          <div class="sub-card-body">
            <div class="sub-card-top">
              <div class="sub-student-info">
                <span class="sub-name">{{ s.student_name }}</span>
                <span class="sub-username">&#64;{{ s.username }}</span>
              </div>
              <div class="sub-chips">
                <span class="chip chip-cat">{{ s.question_category }}</span>
                <span *ngIf="s.has_video" class="chip chip-video">🎥 Video</span>
                <span *ngIf="!s.has_video" class="chip chip-no-video">No video</span>
                <span class="sub-time">{{ s.submitted_at | date:'MMM d, h:mm a' }}</span>
              </div>
            </div>
            <div class="sub-question">{{ s.question_text }}</div>
            <div class="sub-answer">{{ s.answer }}</div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class AdminSubmissionsComponent {
  @Input() filteredSubmissions: Submission[] = [];
  @Input() students: Student[] = [];
  @Input() categoryOptions: Array<{ value: string; label: string }> = [];
  @Input() searchTerm: string = '';
  @Input() filterStudent: string = '';
  @Input() submissionFilterCategory: string = '';

  @Output() openSubmission = new EventEmitter<Submission>();
  @Output() filterChange = new EventEmitter<{ search: string; student: string; category: string }>();

  onFilterChange() {
    this.filterChange.emit({
      search: this.searchTerm,
      student: this.filterStudent,
      category: this.submissionFilterCategory
    });
  }
}
