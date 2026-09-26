import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface OverviewStats {
  totalStudents: number;
  activeStudentsCount: number;
  totalQuestions: number;
  totalGroups: number;
  studentActivity?: Array<{
    name: string;
    username: string;
    count: number;
  }>;
}

@Component({
  selector: 'app-admin-overview',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="view active">
      <div class="page-header">
        <div>
          <h1 class="page-title">Dashboard Overview</h1>
          <p class="page-subtitle">Monitor your interview platform in real-time</p>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card kpi-indigo" (click)="navigateView.emit('students')" style="cursor: pointer;">
          <div class="kpi-card-inner">
            <div class="kpi-icon-wrap">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div class="kpi-data">
              <div class="kpi-value">{{ overviewStats.totalStudents }}</div>
              <div class="kpi-label">Total Students</div>
            </div>
          </div>
          <div class="kpi-trend"><span class="trend-up">↗</span> All registered</div>
        </div>

        <div class="kpi-card kpi-emerald">
          <div class="kpi-card-inner">
            <div class="kpi-icon-wrap">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div class="kpi-data">
              <div class="kpi-value">{{ overviewStats.activeStudentsCount }}</div>
              <div class="kpi-label">Total Interview Done</div>
            </div>
          </div>
          <div class="kpi-trend"><span class="trend-up">↗</span> Completed interviews</div>
        </div>

        <div class="kpi-card kpi-violet" (click)="navigateView.emit('questions')" style="cursor: pointer;">
          <div class="kpi-card-inner">
            <div class="kpi-icon-wrap">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div class="kpi-data">
              <div class="kpi-value">{{ overviewStats.totalQuestions }}</div>
              <div class="kpi-label">Total Questions</div>
            </div>
          </div>
          <div class="kpi-trend"><span class="trend-up">↗</span> In question bank</div>
        </div>

        <div class="kpi-card kpi-amber" (click)="navigateView.emit('students')" style="cursor: pointer;">
          <div class="kpi-card-inner">
            <div class="kpi-icon-wrap">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div class="kpi-data">
              <div class="kpi-value">{{ overviewStats.totalGroups }}</div>
              <div class="kpi-label">Total Groups</div>
            </div>
          </div>
          <div class="kpi-trend"><span class="trend-up">↗</span> All batches</div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-header">
          <div class="section-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            Student Activity
          </div>
          <button class="link-btn" (click)="navigateView.emit('students')">View all →</button>
        </div>

        <div *ngIf="!overviewStats?.studentActivity || overviewStats.studentActivity!.length === 0" class="empty-state">
          <div class="empty-icon">📊</div>
          <div class="empty-text">No activity yet</div>
        </div>

        <div
          *ngFor="let act of (overviewStats?.studentActivity || [])"
          class="activity-row"
          (click)="filterStudentActivity.emit({ username: act.username, name: act.name })"
        >
          <div class="act-avatar">{{ (act.name || act.username || '?')[0].toUpperCase() }}</div>
          <div class="act-info">
            <div class="act-name">{{ act.name }}</div>
            <div class="act-user">&#64;{{ act.username }}</div>
          </div>
          <div class="act-stat">
            <div class="act-count">{{ act.count }}</div>
            <div class="act-count-label">submission{{ act.count !== 1 ? 's' : '' }}</div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class AdminOverviewComponent {
  @Input() overviewStats: OverviewStats = {
    totalStudents: 0,
    activeStudentsCount: 0,
    totalQuestions: 0,
    totalGroups: 0,
    studentActivity: []
  };

  @Output() navigateView = new EventEmitter<string>();
  @Output() filterStudentActivity = new EventEmitter<{ username: string; name: string }>();
}
