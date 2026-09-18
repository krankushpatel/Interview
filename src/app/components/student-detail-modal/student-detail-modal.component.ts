import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, AlertController, ToastController } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import { AdminService } from '../../services/admin.service';
import { VideoModalComponent } from '../video-modal/video-modal.component';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { environment } from '../../../environments/environment';
import jsPDF from 'jspdf';
import { HexagonLayoutService } from '../../services/hexagon-layout.service';
import { ScoreLegendComponent } from '../../services/score-legend.component';
import { AttemptPreviewModalComponent } from '../attempt-preview-modal/attempt-preview-modal.component';
import { PdfGeneratorService } from '../../services/pdf-generator.service'; 
interface EventCount {
  event: string;
  count: number;
  display: string;
}

@Component({
  selector: 'app-student-detail-modal',
  standalone: true,
  imports: [CommonModule, IonicModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar style="--background: var(--dip-surface); border-bottom: 1px solid var(--dip-border);">
        <ion-title style="font-weight: 800; font-size: 1.2rem; color: var(--dip-text-primary);">Student : {{ studentName }}</ion-title>
        <ion-buttons slot="end">
          <ion-button color="danger" (click)="deleteStudent()" style="font-weight: 800; font-size: 1rem;">🗑️ DELETE</ion-button>
          <ion-button (click)="close()" style="font-weight: 800; color: var(--dip-text-secondary); font-size: 1rem;">✕ CLOSE</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding" style="--background: var(--dip-bg-primary, #ccd7df);">
      <div *ngIf="isLoading" style="text-align: center; margin-top: 5rem;">
        <ion-spinner name="crescent" style="color: var(--dip-brand-1);"></ion-spinner>
        <p style="color: var(--dip-brand-1); font-weight: 700;">Loading profile and history...</p>
      </div>

      <div *ngIf="!isLoading && fullData">
        
        <!-- Profile Card -->
        <div class="ph-card">
          <div class="ph-avatar">{{ fullData.profile?.name?.charAt(0).toUpperCase() }}</div>
          
          <div class="ph-info">
            <h2>{{ fullData.profile?.name }}</h2>
            <p>@{{ fullData.profile?.username }} | {{ fullData.profile?.email }}</p>
            <div class="ph-tags">
              <span class="p-tag t-active" *ngIf="fullData.profile?.status === 'Active'">{{ fullData.profile?.status }}</span>
              <span class="p-tag t-terminated" *ngIf="fullData.profile?.status === 'Terminated'">{{ fullData.profile?.status }}</span>
              <span class="p-tag t-info">{{ fullData.profile?.attempts_taken }} / {{ maxAttempts === -1 ? '∞' : maxAttempts }} ATTEMPTS</span>
            </div>
          </div>

          <div class="admin-actions">
            <ion-button size="small" fill="outline" style="--color: var(--dip-brand-1); --border-color: var(--dip-brand-1);" (click)="allowReattempt()">
              ↻ +1 ATTEMPT
            </ion-button>
            <ion-button size="small" fill="outline" color="danger" (click)="resetTermination()" *ngIf="fullData.profile?.status === 'Terminated'">
              ✅ RESET TERMINATION
            </ion-button>
          </div>
        </div>

        <!-- Preferred Categories -->
        <div class="pref-card">
          <h3 class="pref-title">🏷️ Preferred Categories / Topics</h3>
          <div class="categories-list">
            <span *ngFor="let cat of availableCategories" 
                  class="category-chip"
                  [class.selected]="selectedCategories.includes(cat)"
                  (click)="toggleCategory(cat)">
              {{ cat }}
            </span>
          </div>
          <ion-button expand="block" (click)="updatePreferredCategories()" [disabled]="!selectedCategories.length" style="--background: var(--dip-brand-1); --color: var(--dip-text-inverse); font-weight: bold; margin-top: 10px;">
            💾 SAVE CATEGORIES
          </ion-button>
        </div>

        <!-- Exam Schedule Card -->
        <div class="schedule-card">
          <h3 class="pref-title" style="margin-bottom: 0.5rem;">📅 Exam Schedule</h3>
          <div *ngIf="!studentTimetable" class="empty-txt" style="text-align: left; padding: 0.5rem 0;">
            ⏳ No schedule assigned. Please set timetable from admin panel.
          </div>
          <div *ngIf="studentTimetable && studentTimetable.schedule">
            <div class="schedule-detail-row">
              <span class="schedule-label">📌 Start:</span>
              <span class="schedule-value">{{ formatScheduleTime(studentTimetable.schedule.start_time) }}</span>
            </div>
            <div class="schedule-detail-row">
              <span class="schedule-label">⏰ End:</span>
              <span class="schedule-value">{{ formatScheduleTime(studentTimetable.schedule.end_time) }}</span>
            </div>
            <div class="schedule-detail-row">
              <span class="schedule-label">📚 Topics:</span>
              <span class="schedule-value">{{ studentTimetable.schedule.topics?.join(', ') || 'Not specified' }}</span>
            </div>
            <div class="schedule-detail-row">
              <span class="schedule-label">📌 Status:</span>
              <span class="schedule-value" [style.color]="studentTimetable.schedule.is_active ? 'var(--dip-success)' : 'var(--dip-danger)'">
                {{ studentTimetable.schedule.is_active ? 'Active' : 'Inactive' }}
              </span>
            </div>
          </div>
        </div>

        <h3 style="margin: 2rem 0.5rem 1rem; font-weight: 800; color: var(--dip-text-primary); text-transform: uppercase; font-size: 1rem;">
          Exam Attempt History
        </h3>
        
        <div *ngIf="!fullData.history?.length" class="empty-state">
          <p>No exam attempts found for this student.</p>
        </div>

        <!-- ════ NAYA CLEAN ATTEMPT LIST (Accordion Hataya Gaya) ════ -->
        <div *ngIf="fullData.history?.length > 0" class="attempt-list">
          <div *ngFor="let attempt of fullData.history" class="attempt-card" style="background: var(--dip-surface); border-radius: 12px; padding: 1.2rem; margin-bottom: 1rem; border: 1px solid var(--dip-border); display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 10px rgba(0,0,0,0.03);">
            
            <!-- Info -->
            <div>
              <h4 style="margin: 0; font-weight: 900; color: var(--dip-brand-1); font-size: 1.1rem;">Attempt #{{ attempt.attempt_number }}</h4>
              <p style="margin: 4px 0 0; color: var(--dip-text-secondary); font-size: 0.85rem; font-family: monospace;">ID: {{ attempt.session_id.substring(0,8) }}...</p>
            </div>

            <!-- Actions & Buttons -->
            <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
              <!-- Status Badge -->
              <span [style.background]="attempt.result?.final_result?.decision === 'Selected' ? 'var(--dip-success)' : 'var(--dip-danger)'" style="color: white; padding: 6px 12px; border-radius: 8px; font-weight: 800; font-size: 0.85rem;">
                {{ attempt.result?.final_result?.decision || 'Review Pending' }}
              </span>

              <!-- 👁️ NEW PREVIEW BUTTON -->
              <ion-button size="small" style="--background: var(--dip-bg-secondary); --color: var(--dip-text-primary); --border-radius: 8px; font-weight: 700;" (click)="openPreviewModal(attempt)">
                👁️ Preview
              </ion-button>

              <!-- 📄 REPORT BUTTON -->
              <ion-button size="small" fill="outline" style="--color: var(--dip-brand-1); --border-color: var(--dip-brand-1); --border-radius: 8px; font-weight: 700;" (click)="$event.stopPropagation(); downloadReport(attempt)">
                📄 Report
              </ion-button>
            </div>

          </div>
        </div>

      </div>
    </ion-content>
  `,
  styles: [`
    .ph-card { background: var(--dip-surface); border-radius: 20px; padding: 1.8rem; display: flex; align-items: center; gap: 1.5rem; border: 1px solid var(--dip-border); flex-wrap: wrap; margin-bottom: 1.5rem; }
    .ph-avatar { width: 70px; height: 70px; border-radius: 50%; background: linear-gradient(135deg, var(--dip-brand-1), var(--dip-brand-2)); color: var(--dip-text-inverse); display: flex; align-items: center; justify-content: center; font-size: 2.2rem; font-weight: 900; flex-shrink: 0; }
    .ph-info { flex: 1; min-width: 250px; }
    .ph-info h2 { margin: 0; font-size: 1.5rem; color: var(--dip-text-primary); font-weight: 800; }
    .ph-info p { margin: 4px 0 12px; color: var(--dip-text-secondary); font-size: 0.95rem; }
    .ph-tags { display: flex; gap: 10px; flex-wrap: wrap; }
    .p-tag { padding: 5px 14px; border-radius: 30px; font-size: 0.8rem; font-weight: 800; border: 1px solid transparent; }
    .t-active { background: rgba(16, 185, 129, 0.1); color: var(--dip-success); border-color: rgba(16, 185, 129, 0.3); }
    .t-terminated { background: rgba(239, 68, 68, 0.1); color: var(--dip-danger); border-color: rgba(239, 68, 68, 0.3); }
    .t-info { background: rgba(59, 130, 246, 0.1); color: var(--dip-info); border-color: rgba(59, 130, 246, 0.3); }
    .admin-actions { display: flex; gap: 10px; flex-direction: column; }
    .pref-card { background: var(--dip-surface); border-radius: 20px; padding: 1.5rem; border: 1px solid var(--dip-border); margin-bottom: 1.5rem; }
    .pref-title { margin: 0 0 15px 0; font-size: 1.1rem; color: var(--dip-text-primary); font-weight: 800; }
    .categories-list { display: flex; flex-wrap: wrap; gap: 8px; }
    .category-chip { background: var(--dip-bg-secondary); border: 1px solid var(--dip-border); padding: 6px 14px; border-radius: 20px; font-size: 0.85rem; font-weight: 700; color: var(--dip-text-secondary); cursor: pointer; transition: all 0.2s; }
    .category-chip:hover { background: var(--dip-bg-tertiary); }
    .category-chip.selected { background: var(--dip-brand-1); color: var(--dip-text-inverse); border-color: transparent; }
    .schedule-card { background: var(--dip-surface); border-radius: 20px; padding: 1.5rem; border: 1px solid var(--dip-border); margin-bottom: 1.5rem; }
    .schedule-detail-row { display: flex; padding: 0.5rem 0; border-bottom: 1px dashed var(--dip-border); }
    .schedule-label { font-weight: 800; width: 70px; color: var(--dip-text-primary); }
    .schedule-value { color: var(--dip-text-secondary); font-weight: 600; }
    .schedule-detail-row:last-child { border-bottom: none; }
    .empty-state { text-align: center; padding: 2rem; color: var(--dip-brand-1); background: var(--dip-surface); border-radius: 16px; border: 1px solid var(--dip-border); }
    .empty-txt { color: var(--dip-text-placeholder); text-align: center; font-style: italic; }
  `]
})
export class StudentDetailModalComponent implements OnInit {
  @Input() username!: string;
  @Input() studentName!: string;

  isLoading = true;
  fullData: any = null;
  maxAttempts = 1;
  studentTimetable: any = null;

  availableCategories: string[] = [];
  selectedCategories: string[] = [];

  apiUrl = environment.apiUrl;

  constructor(
    private modalCtrl: ModalController,
    private adminService: AdminService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private http: HttpClient,
    private hexService: HexagonLayoutService,
    private pdfGenerator: PdfGeneratorService
  ) {}

  async ngOnInit() {
    await this.loadDependencies();
    await this.loadProfile();
    this.loadTimetable();
  }

  async loadDependencies() {
    try {
      this.availableCategories = await this.adminService.getAllCategoriesStandalone();
    } catch (e) {
      console.warn('Could not load categories', e);
    }
  }

  async loadProfile() {
    this.isLoading = true;
    try {
      this.fullData = await this.adminService.getStudentFullProfile(this.username);
      const status = await this.adminService.getAttemptStatus(this.username);
      this.maxAttempts = status.max_attempts;
      this.selectedCategories = status.preferred_categories || [];

      // Evidence Mapping
      try {
        const evidenceRes = await lastValueFrom(
          this.http.get<any>(`${this.apiUrl}/recording/proctoring/evidence/${this.username}`)
        );
        
        if (evidenceRes.success && evidenceRes.evidence && this.fullData.history) {
          this.fullData.history.forEach((attempt: any) => {
            attempt.evidence = evidenceRes.evidence.filter(
              (ev: any) => ev.session_id === attempt.session_id
            );
          });
          console.log('✅ Evidence mapped strictly to correct attempts!');
        }
      } catch (evErr) {
        console.warn('⚠️ Could not load evidence snapshots:', evErr);
      }

    } catch (err) {
      console.error('Profile Load Error:', err);
      if (!this.fullData) {
        this.fullData = {
          success: true,
          profile: {
            username: this.username,
            name: this.studentName || this.username,
            email: `${this.username}@example.com`,
            status: 'Active',
            attempts_taken: 1,
            max_attempts: this.maxAttempts || 3
          },
          history: []
        };
      }
    } finally {
      this.isLoading = false;
    }
  }

  async allowReattempt() {
    try {
      await this.adminService.increaseAttempts(this.username, 1);
      this.maxAttempts++;
      this.showToast('Attempts increased! Student can take the test again.', 'success');
      await this.loadProfile();
    } catch (err) {
      this.showToast('Failed to increase attempts', 'danger');
    }
  }

  async resetTermination() {
    try {
      const formData = new FormData();
      formData.append('username', this.username);
      await this.http.post(`${environment.apiUrl}/admin/student/reset-termination`, formData).toPromise();
      this.showToast('Termination reset successfully!', 'success');
      await this.loadProfile();
    } catch (err) {
      this.showToast('Failed to reset termination', 'danger');
    }
  }

  async deleteStudent() {
    const alert = await this.alertCtrl.create({
      header: 'Delete Student',
      message: `Are you sure you want to delete "${this.studentName}" and all their data? This action cannot be undone.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            try {
              await this.adminService.deleteStudent(this.username);
              this.showToast('Student deleted successfully.', 'success');
              this.modalCtrl.dismiss(true);
            } catch (err) {
              this.showToast('Failed to delete student.', 'danger');
            }
          }
        }
      ]
    });
    await alert.present();
  }

  // ✅ NAYA: Function to open the dedicated Preview Modal
  async openPreviewModal(attempt: any) {
    const modal = await this.modalCtrl.create({
      component: AttemptPreviewModalComponent,
      componentProps: {
        attempt: attempt,
        apiUrl: this.apiUrl
      },
      cssClass: 'large-preview-modal'
    });
    await modal.present();
  }

  // Fallback if needed, though mostly moved to Preview Modal
  async viewFullImage(imagePath: string) {
    const fullUrl = `${this.apiUrl}/uploads/${imagePath}`;
    const alert = await this.alertCtrl.create({
      header: 'Evidence Snapshot',
      message: `<img src="${fullUrl}" style="width: 100%; border-radius: 8px;" />`,
      buttons: ['Close'],
      cssClass: 'custom-image-alert'
    });
    await alert.present();
  }

  async playVideo(filename: string) {
    const videoUrl = `${environment.apiUrl}/uploads/${filename}`;
    const modal = await this.modalCtrl.create({
      component: VideoModalComponent,
      componentProps: { videoUrl, videoTitle: 'Recording Playback' }
    });
    await modal.present();
  }

  async showToast(message: string, color: string) {
    const toast = await this.toastCtrl.create({ message, duration: 2500, color, position: 'bottom' });
    await toast.present();
  }

  async loadTimetable() {
    try {
      this.studentTimetable = await this.adminService.getTimetable(this.username);
    } catch (e) {
      this.studentTimetable = null;
    }
  }

  formatScheduleTime(val: any): string {
    if (!val) return 'Not set';
    if (typeof val === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(val.trim())) {
      const parts = val.trim().split(':');
      const hours = parseInt(parts[0], 10);
      const minutes = parts[1];
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const formattedHours = hours % 12 || 12;
      return `${formattedHours}:${minutes} ${ampm}`;
    }
    const d = new Date(val);
    if (isNaN(d.getTime())) {
      return String(val);
    }
    return d.toLocaleString('en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  // ── PDF Report Download ───────────────────────────────────────────────────
  async loadImageAsBase64(path: string): Promise<string | null> {
    try {
      const response = await fetch(path);
      if (!response.ok) return null;
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('Image load failed:', path, e);
      return null;
    }
  }

  getSmallHexPath(cx: number, cy: number, r: number): string {
    const w = r * Math.sqrt(3) / 2;
    const points = [
      { x: cx - w, y: cy - r / 2 }, { x: cx, y: cy - r }, { x: cx + w, y: cy - r / 2 },
      { x: cx + w, y: cy + r / 2 }, { x: cx, y: cy + r }, { x: cx - w, y: cy + r / 2 },
    ];
    return `M ${points.map(p => `${p.x} ${p.y}`).join(' L ')} Z`;
  }

  getHexTextColor(score: number): string {
    if (score >= 39.5 && score < 90.5) return '#1a1a1a';
    return '#ffffff';
  }

  generateHexGridForPdf(questions: any[]) {
    if (!questions.length) return { rawHexagons: [], hexBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
    const numberOfHex = questions.length;
    const rowDistribution = this.hexService.getRowDistribution(numberOfHex);
    if (!rowDistribution) return { rawHexagons: [], hexBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };

    const dims = this.hexService.calcDimensions(numberOfHex, 1, rowDistribution);
    const hexStructure = this.hexService.initHexStructure(rowDistribution, dims.marginX, dims.marginY, dims.hexWidth, dims.hexRadius);
    const rawHexagons: any[] = [];
    let testCount = 0;

    for (let row = 1; row <= rowDistribution.length; row++) {
      const hexagonsInRow = rowDistribution[row - 1];
      for (let hex = 1; hex <= hexagonsInRow; hex++) {
        testCount++;
        if (testCount > numberOfHex) break;
        const q = questions[testCount - 1];
        const avgScore = q.average_score ?? (((q.scores?.correctness || 0) + (q.scores?.completeness || 0) + (q.scores?.clarity || 0)) / 30);
        const path = this.hexService.getHexPath(hexStructure, testCount, row, 0, dims);
        const centerX = this.hexService.getHexCenterX(hexStructure, 0, row, testCount, dims);
        const centerY = this.hexService.getHexCenterY(hexStructure, 0, row, testCount, dims);
        const color = this.hexService.getHexColor(avgScore * 10);
        rawHexagons.push({ questionIndex: testCount - 1, path, centerX, centerY, color, score: avgScore, label: `Q${testCount}` });
      }
    }

    let rawMinX = Infinity, rawMinY = Infinity, rawMaxX = -Infinity, rawMaxY = -Infinity;
    for (const hex of rawHexagons) {
      const nums = hex.path.match(/[\d\.]+/g)?.map(Number) || [];
      for (let i = 0; i < nums.length; i += 2) {
        rawMinX = Math.min(rawMinX, nums[i]); rawMinY = Math.min(rawMinY, nums[i + 1]);
        rawMaxX = Math.max(rawMaxX, nums[i]); rawMaxY = Math.max(rawMaxY, nums[i + 1]);
      }
    }
    return { rawHexagons, hexBounds: { minX: rawMinX, minY: rawMinY, maxX: rawMaxX, maxY: rawMaxY } };
  }

  getAggregateMetricsForPdf(questions: any[]) {
    if (!questions.length) return [];
    const metrics = [
      { key: 'correctness', label: 'Correctness', shortLabel: 'C1' },
      { key: 'completeness', label: 'Completeness', shortLabel: 'C2' },
      { key: 'clarity', label: 'Clarity', shortLabel: 'C3' }
    ];
    const r = 24; const w = r * Math.sqrt(3) / 2; const padding = 2;
    const svgW = Math.ceil(w * 2 + padding * 2); const svgH = Math.ceil(r * 2 + padding * 2);
    const numQ = questions.length;
    return metrics.map(m => {
      const sum = questions.reduce((acc: number, q: any) => acc + (q.scores?.[m.key] || 0), 0);
      const pct = numQ > 0 ? (sum / (numQ * 10)) * 100 : 0;
      const cx = svgW / 2; const cy = svgH / 2;
      return {
        path: this.getSmallHexPath(cx, cy, r), centerX: cx, centerY: cy,
        color: this.hexService.getHexColor(pct), textColor: this.getHexTextColor(pct),
        percentage: Math.round(pct), label: m.label, shortLabel: m.shortLabel, svgWidth: svgW, svgHeight: svgH
      };
    });
  }

  async downloadReport(attempt: any) {
    if (!attempt.result) {
      this.showToast('No evaluation result found for this attempt.', 'warning');
      return;
    }

    // Ensure questions are unique before generating hexagons and PDF
    const rawQList: any[] = attempt.result.questions || [];
    const seenQ = new Set<string>();
    const dedupedQuestions = rawQList.filter((q: any, idx: number) => {
      const key = q?.id != null ? `id_${q.id}` : (q?.question ? `text_${String(q.question).trim().toLowerCase()}` : `idx_${idx}`);
      if (seenQ.has(key)) return false;
      seenQ.add(key);
      return true;
    });
    attempt.result.questions = dedupedQuestions;

    // Hexagon UI banayen, kyuki admin side pe frontend UI auto-generate nahi hota
    const { rawHexagons, hexBounds } = this.generateHexGridForPdf(dedupedQuestions);
    const aggMetrics = this.getAggregateMetricsForPdf(dedupedQuestions);

    // File ka suffix set karein: (e.g. "_Attempt1_xyz123")
    const sidShort = attempt.session_id ? attempt.session_id.substring(0, 8) : 'unknown'; 
    const suffix = `_Attempt${attempt.attempt_number}_${sidShort}`;

    // Common Service Call
    await this.pdfGenerator.generateAndDownloadPDF(
      attempt.result,          // Backend ka pura result
      rawHexagons,             // Calculated hexagons
      hexBounds,               // Layout bounds
      aggMetrics,              // Aggregate percentages
      [],                      // Grouped events UI array (khali bhej sakte hain admin se)
      suffix                   // Custom File Suffix
    );

    this.showToast('📄 Premium Report downloaded successfully!', 'success');
  }

  groupProctoringEvents(proctoring: any[]): EventCount[] {
    if (!proctoring?.length) return [];
    const counts: Record<string, number> = {};
    for (const ev of proctoring) {
      const raw = ev.event || ev.type || 'unknown';
      const clean = raw.toString().replace(/\s*\(WebSocket\)\s*/gi, '').replace(/\s+/g, '_').trim().toLowerCase();
      counts[clean] = (counts[clean] || 0) + 1;
    }
    const grouped = Object.entries(counts).map(([event, count]) => ({
      event,
      count,
      display: event.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    }));
    grouped.sort((a, b) => b.count - a.count);
    return grouped;
  }

  toggleCategory(category: string) {
    const index = this.selectedCategories.indexOf(category);
    if (index > -1) {
      this.selectedCategories.splice(index, 1);
    } else {
      this.selectedCategories.push(category);
    }
  }

  async updatePreferredCategories() {
    try {
      await this.adminService.setStudentCategories(this.username, this.selectedCategories);
      this.showToast('Preferred topics saved successfully!', 'success');
    } catch (err) {
      this.showToast('Failed to save topics', 'danger');
    }
  }

  close() { this.modalCtrl.dismiss(); }
}