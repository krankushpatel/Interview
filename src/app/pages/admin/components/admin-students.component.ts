import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Student } from '../../../services/admin.service';

@Component({
  selector: 'app-admin-students',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="view active">
      <div class="page-header">
        <div>
          <h1 class="page-title">Students</h1>
          <p class="page-subtitle">Manage registered student accounts and groups</p>
        </div>
      </div>

      <div class="students-toolbar">
        <div class="search-wrap flex-1">
          <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            class="search-input"
            type="text"
            placeholder="Search by name, username, email..."
            [(ngModel)]="studentSearch"
            (input)="studentSearchChange.emit(studentSearch)"
          />
        </div>

        <button class="btn btn-outline btn-sm" (click)="openCreateGroup.emit()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <line x1="23" y1="11" x2="17" y2="11"/><line x1="20" y1="8" x2="20" y2="14"/>
          </svg>
          Create Group
        </button>
        <button class="btn btn-primary btn-sm" (click)="openAddStudent.emit()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Student
        </button>
      </div>

      <div class="segment-tabs">
        <button
          class="seg-tab"
          [class.active]="studentSubView === 'individual'"
          (click)="subViewChange.emit('individual')"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
          Individual <span class="seg-count">{{ students.length }}</span>
        </button>
        <button
          class="seg-tab"
          [class.active]="studentSubView === 'groups'"
          (click)="subViewChange.emit('groups')"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          Groups <span class="seg-count" *ngIf="groups.length > 0">{{ groups.length }}</span>
        </button>
      </div>

      <!-- Individual Tab -->
      <div *ngIf="studentSubView === 'individual'">
        <div class="students-grid">
          <div
            *ngFor="let st of filteredStudents"
            class="student-card"
            (click)="selectStudent.emit({ username: st.username, name: st.name })"
          >
            <div class="student-select" (click)="$event.stopPropagation()">
              <label class="checkbox-wrap">
                <input
                  type="checkbox"
                  [checked]="selectedStudentsForEmail.includes(st.username)"
                  (change)="toggleEmailSelection.emit(st.username)"
                />
                <span class="checkmark"></span>
              </label>
            </div>
            <div *ngIf="st.isLive" class="student-live-indicator"><span class="live-pulse-dot"></span> LIVE</div>
            <div class="student-card-top">
              <div class="student-avatar-lg">{{ (st.name || st.username || '?')[0].toUpperCase() }}</div>
              <div class="student-identity">
                <div class="student-name">{{ st.name }}</div>
                <div class="student-handle">&#64;{{ st.username }}</div>
                <div *ngIf="st.is_terminated" class="terminated-chip">🚫 Terminated</div>
              </div>
            </div>
            <div class="student-email">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              {{ st.email || '—' }}
            </div>
            <div class="student-stats-row">
              <div class="stu-stat">
                <div class="stu-stat-val">{{ answerCounts[st.username] || 0 }}</div>
                <div class="stu-stat-label">Answers</div>
              </div>
              <div class="stu-stat-divider"></div>
              <div class="stu-stat">
                <div class="stu-stat-val">{{ videoCounts[st.username] || 0 }}</div>
                <div class="stu-stat-label">Videos</div>
              </div>
            </div>
            <div class="student-card-actions">
              <button
                class="card-action-btn"
                (click)="$event.stopPropagation(); openTimetable.emit(st)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                Set Schedule
              </button>
            </div>
          </div>
        </div>

        <div class="floating-group-bar" *ngIf="selectedStudentsForEmail.length >= 1">
          <div class="fgb-left">
            <div class="fgb-count">{{ selectedStudentsForEmail.length }}</div>
            <div class="fgb-label">students selected</div>
          </div>
          <div class="fgb-actions">
            <button class="fgb-btn fgb-btn-group" (click)="createGroupFromSelection.emit()">👥 Create Group</button>
            <button class="fgb-btn fgb-btn-schedule" (click)="openBulkSchedule.emit()">📅 Schedule</button>
            <button class="fgb-btn fgb-btn-email" (click)="openBulkEmail.emit()">📧 Email</button>
            <button class="fgb-btn fgb-btn-cancel" (click)="clearEmailSelection.emit()">✕ Clear</button>
          </div>
        </div>
      </div>

      <!-- Groups Tab -->
      <div *ngIf="studentSubView === 'groups'">
        <div *ngIf="groups.length === 0" class="empty-state-full">
          <div class="esf-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <div class="esf-title">No groups yet</div>
          <div class="esf-sub">Create your first group to batch schedule interviews</div>
          <button class="btn btn-primary" style="margin-top:1.5rem" (click)="openCreateGroup.emit()">
            + Create First Group
          </button>
        </div>

        <div class="groups-grid" *ngIf="groups.length > 0">
          <div class="group-card" *ngFor="let group of groups">
            <div class="group-card-header">
              <div class="group-icon-wrap">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <div class="group-meta">
                <div class="group-name">{{ group.name }}</div>
                <div class="group-date">Created {{ group.created_at | date:'dd MMM yyyy' }}</div>
              </div>
              <button
                class="group-delete-btn"
                (click)="deleteGroup.emit({ id: group.id, name: group.name })"
                title="Delete group"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div class="group-students-row">
              <div class="group-avatars">
                <div
                  class="group-av"
                  *ngFor="let u of (group.students || []).slice(0, 5)"
                  [title]="studentNames[u] || u"
                >
                  {{ u[0].toUpperCase() }}
                </div>
                <div class="group-av group-av-more" *ngIf="(group.students?.length || 0) > 5">
                  +{{ group.students.length - 5 }}
                </div>
              </div>
              <span class="group-count">{{ group.students?.length || 0 }} students</span>
            </div>

            <div class="group-scheduled" *ngIf="group.last_scheduled_at">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Scheduled {{ group.last_scheduled_at | date:'dd MMM yyyy, hh:mm a' }}
            </div>

            <div class="group-card-actions" style="display: flex; gap: 8px;">
              <button
                class="group-action-btn group-action-outline"
                style="flex: 1; background: var(--dip-surface); color: var(--dip-text-primary); border: 1px solid var(--dip-border); padding: 10px; font-weight: 600; border-radius: 8px; cursor: pointer;"
                (click)="openGroupDetail.emit({ group: group, tab: 'students' })"
              >
                👥 Students
              </button>
              <button
                class="group-action-btn group-action-outline"
                style="flex: 1; background: var(--dip-surface); color: var(--dip-text-primary); border: 1px solid var(--dip-border); padding: 10px; font-weight: 600; border-radius: 8px; cursor: pointer;"
                (click)="openGroupDetail.emit({ group: group, tab: 'settings' })"
              >
                ⚙️ Settings
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class AdminStudentsComponent {
  @Input() students: Student[] = [];
  @Input() filteredStudents: Student[] = [];
  @Input() groups: any[] = [];
  @Input() studentSearch: string = '';
  @Input() studentSubView: 'individual' | 'groups' = 'individual';
  @Input() selectedStudentsForEmail: string[] = [];
  @Input() answerCounts: Record<string, number> = {};
  @Input() videoCounts: Record<string, number> = {};
  @Input() studentNames: Record<string, string> = {};

  @Output() studentSearchChange = new EventEmitter<string>();
  @Output() subViewChange = new EventEmitter<'individual' | 'groups'>();
  @Output() openAddStudent = new EventEmitter<void>();
  @Output() openCreateGroup = new EventEmitter<void>();
  @Output() selectStudent = new EventEmitter<{ username: string; name: string }>();
  @Output() toggleEmailSelection = new EventEmitter<string>();
  @Output() openTimetable = new EventEmitter<Student>();
  @Output() createGroupFromSelection = new EventEmitter<void>();
  @Output() openBulkSchedule = new EventEmitter<void>();
  @Output() openBulkEmail = new EventEmitter<void>();
  @Output() clearEmailSelection = new EventEmitter<void>();
  @Output() deleteGroup = new EventEmitter<{ id: number; name: string }>();
  @Output() openGroupDetail = new EventEmitter<{ group: any; tab: string }>();
}
