import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-admin-session-logs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../admin.page.scss'],
  template: `
    <div class="view active">
      <div class="page-header">
        <div>
          <h1 class="page-title">Session Logs</h1>
          <p class="page-subtitle">Student login, logout, and exam activity</p>
        </div>
      </div>

      <div class="filter-bar">
        <div class="search-wrap flex-1">
          <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            class="search-input"
            type="text"
            placeholder="Search by student, action, or details..."
            [(ngModel)]="search"
            (input)="onSearchChange()"
          />
        </div>
      </div>

      <div *ngIf="logs.length === 0" class="empty-state-full">
        <div class="esf-icon">📋</div>
        <div class="esf-title">No logs found</div>
      </div>

      <div class="logs-table" *ngIf="logs.length > 0">
        <div class="logs-table-head">
          <div>User</div>
          <div>Action</div>
          <div>Details</div>
          <div>Timestamp</div>
        </div>
        <div class="log-row" *ngFor="let log of logs">
          <div class="log-user">
            <div class="log-user-avatar">{{ (log.username || '?')[0].toUpperCase() }}</div>
            <span>{{ log.username }}</span>
          </div>
          <div>
            <span
              class="log-action-badge"
              [class.badge-login]="log.action === 'login'"
              [class.badge-logout]="log.action === 'logout'"
              [class.badge-start]="log.action === 'start_exam'"
              [class.badge-finish]="log.action === 'finish_exam'"
              [class.badge-terminated]="log.action === 'exam_terminated'"
            >
              {{ log.action | titlecase }}
            </span>
          </div>
          <div class="log-details">{{ log.details }}</div>
          <div class="log-time">{{ log.timestamp | date:'medium' }}</div>
        </div>
      </div>
    </div>
  `
})
export class AdminSessionLogsComponent {
  @Input() logs: any[] = [];
  @Input() search: string = '';

  @Output() searchChange = new EventEmitter<string>();

  onSearchChange() {
    this.searchChange.emit(this.search);
  }
}
