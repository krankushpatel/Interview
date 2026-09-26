import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-admin-bulk-import',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../admin.page.scss'],
  template: `
    <div class="view active">
      <div class="page-header">
        <div>
          <h1 class="page-title">Bulk Import</h1>
          <p class="page-subtitle">Import students and questions from Excel or CSV files</p>
        </div>
      </div>

      <div class="import-grid">
        <!-- Students Import Card -->
        <div class="import-card">
          <div class="import-card-header">
            <div class="import-card-icon import-icon-indigo">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              </svg>
            </div>
            <div>
              <div class="import-card-title">Bulk Import Students</div>
              <div class="import-card-sub">Upload Excel / CSV file</div>
            </div>
          </div>

          <div class="drop-zone" (click)="$event.stopPropagation(); studentFileInput.click()" [class.has-file]="studentFile">
            <input type="file" #studentFileInput accept=".xlsx,.xls,.csv" (change)="onStudentFileSelected($event)" hidden>
            <div *ngIf="!studentFile" class="drop-zone-content">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polyline points="16 16 12 12 8 16"/>
                <line x1="12" y1="12" x2="12" y2="21"/>
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
              </svg>
              <div class="drop-zone-text">Drop your file here or <span>browse</span></div>
              <div class="drop-zone-hint">Supports .xlsx, .xls, .csv</div>
            </div>
            <div *ngIf="studentFile" class="drop-zone-file">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <span>{{ studentFile.name }}</span>
            </div>
          </div>

          <div class="import-loading-bar" *ngIf="studentsUploading">
            <div class="loading-indicator">
              <div class="loading-spinner"></div>
              <span>Importing students, please wait…</span>
            </div>
          </div>

          <div class="import-options">
            <label class="toggle-wrap">
              <input type="checkbox" [(ngModel)]="sendEmailToStudents" (ngModelChange)="sendEmailChange.emit($event)" />
              <span class="toggle-slider"></span>
              <span class="toggle-label">Send credentials to students via email</span>
            </label>
          </div>

          <div class="import-actions">
            <button
              class="btn btn-primary"
              style="flex:1"
              (click)="uploadStudents.emit()"
              [disabled]="!studentFile || studentsUploading"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="16 16 12 12 8 16"/>
                <line x1="12" y1="12" x2="12" y2="21"/>
              </svg>
              Import Students
            </button>
            <button class="btn btn-outline" (click)="downloadStudentTemplate.emit()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Template
            </button>
          </div>
        </div>

        <!-- Questions Import Card -->
        <div class="import-card">
          <div class="import-card-header">
            <div class="import-card-icon import-icon-violet">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div>
              <div class="import-card-title">Bulk Import Questions</div>
              <div class="import-card-sub">Upload Excel / CSV file</div>
            </div>
          </div>

          <div class="drop-zone" (click)="questionFileInput.click()" [class.has-file]="questionFile">
            <input type="file" #questionFileInput accept=".xlsx,.xls,.csv" (change)="onQuestionFileSelected($event)" hidden>
            <div *ngIf="!questionFile" class="drop-zone-content">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polyline points="16 16 12 12 8 16"/>
                <line x1="12" y1="12" x2="12" y2="21"/>
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
              </svg>
              <div class="drop-zone-text">Drop your file here or <span>browse</span></div>
              <div class="drop-zone-hint">Supports .xlsx, .xls, .csv</div>
            </div>
            <div *ngIf="questionFile" class="drop-zone-file">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <span>{{ questionFile.name }}</span>
            </div>
          </div>

          <div class="import-loading-bar" *ngIf="questionsUploading">
            <div class="loading-indicator">
              <div class="loading-spinner"></div>
              <span>Importing questions, please wait…</span>
            </div>
          </div>

          <div class="import-actions" style="margin-top:1rem">
            <button
              class="btn btn-primary"
              style="flex:1"
              (click)="uploadQuestions.emit()"
              [disabled]="!questionFile || questionsUploading"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="16 16 12 12 8 16"/>
                <line x1="12" y1="12" x2="12" y2="21"/>
              </svg>
              Import Questions
            </button>
            <button class="btn btn-outline" (click)="downloadQuestionTemplate.emit()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Template
            </button>
          </div>
        </div>
      </div>
    </div>
  `
})
export class AdminBulkImportComponent {
  @Input() studentFile: File | null = null;
  @Input() questionFile: File | null = null;
  @Input() studentsUploading: boolean = false;
  @Input() questionsUploading: boolean = false;
  @Input() sendEmailToStudents: boolean = false;

  @Output() studentFileSelected = new EventEmitter<File | null>();
  @Output() questionFileSelected = new EventEmitter<File | null>();
  @Output() uploadStudents = new EventEmitter<void>();
  @Output() uploadQuestions = new EventEmitter<void>();
  @Output() downloadStudentTemplate = new EventEmitter<void>();
  @Output() downloadQuestionTemplate = new EventEmitter<void>();
  @Output() sendEmailChange = new EventEmitter<boolean>();

  onStudentFileSelected(event: any) {
    const file = event?.target?.files?.[0] || null;
    this.studentFileSelected.emit(file);
  }

  onQuestionFileSelected(event: any) {
    const file = event?.target?.files?.[0] || null;
    this.questionFileSelected.emit(file);
  }
}
