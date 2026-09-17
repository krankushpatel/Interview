import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, AlertController } from '@ionic/angular';
import { VideoModalComponent } from '../video-modal/video-modal.component';

interface EventCount {
  event: string;
  count: number;
  display: string;
}

@Component({
  selector: 'app-attempt-preview-modal',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar style="--background: var(--dip-surface, #ffffff); border-bottom: 1px solid var(--dip-border, #bbc4d3);">
        <ion-title style="font-weight: 800; font-size: 1.1rem; color: var(--dip-text-primary);">
          👁️ Preview: Attempt #{{ attempt?.attempt_number }}
        </ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="close()" style="font-weight: 800; color: var(--dip-danger); font-size: 1rem;">✕ CLOSE</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding" style="--background: var(--dip-bg-primary);">
      <!-- Details Accordion -->
      <ion-accordion-group multiple="true" [value]="['res', 'ans', 'media', 'logs']">
                
        <!-- 1. AI EVALUATION -->
        <ion-accordion value="res" class="inner-acc">
          <ion-item slot="header" lines="none" style="--background: var(--dip-surface); --color: var(--dip-text-primary);"><ion-label style="font-weight: 700;">📊 AI Evaluation</ion-label></ion-item>
          <div slot="content" class="inner-content">
            <div *ngIf="!attempt.result" class="empty-txt">Evaluation results not found.</div>
            <div *ngIf="attempt.result" class="res-box" [class.pass]="attempt.result?.final_result?.decision === 'Selected'">
              <div class="score-display">
                <span class="val">{{ attempt.result?.final_result?.adjusted_score || 0 }}</span><span class="total">/100</span>
              </div>
              <p class="summary-txt">{{ attempt.result?.final_result?.summary }}</p>
            </div>
          </div>
        </ion-accordion>

        <!-- 2. STUDENT ANSWERS -->
        <ion-accordion value="ans" class="inner-acc">
          <ion-item slot="header" lines="none" style="--background: var(--dip-surface); --color: var(--dip-text-primary);"><ion-label style="font-weight: 700;">📝 Student Answers</ion-label></ion-item>
          <div slot="content" class="inner-content">
            <!-- Check both submissions and result.questions -->
            <div *ngIf="!attempt.submissions?.length && !attempt.result?.questions?.length" class="empty-txt">No question data found.</div>
            
            <!-- Option A: Primary Submissions -->
            <ng-container *ngIf="attempt.submissions?.length">
              <div *ngFor="let sub of attempt.submissions; let i = index" class="qa-card">
                <div class="q-row"><strong>Q{{ i+1 }}:</strong> {{ sub.question_text }}</div>
                <div class="a-row"><strong>Ans:</strong> {{ sub.answer }}</div>
              </div>
            </ng-container>

            <!-- Option B: Fallback to Evaluation Result Questions -->
            <ng-container *ngIf="!attempt.submissions?.length && attempt.result?.questions?.length">
              <div *ngFor="let q of attempt.result.questions; let i = index" class="qa-card">
                <div class="q-row"><strong>Q{{ i+1 }}:</strong> {{ q.question }}</div>
                <div class="a-row"><strong>Ans:</strong> {{ q.answer }}</div>
                <div *ngIf="q.feedback" style="margin-top: 8px; font-size: 0.8rem; color: var(--dip-brand-1); font-style: italic;">
                  <strong>AI Feedback:</strong> {{ q.feedback }}
                </div>
              </div>
            </ng-container>
          </div>
        </ion-accordion>

        <!-- 3. EXAM MEDIA & EVIDENCE -->
        <ion-accordion value="media" class="inner-acc">
          <ion-item slot="header" lines="none" style="--background: var(--dip-surface); --color: var(--dip-text-primary);">
            <ion-label style="font-weight: 700;">🎬 Exam Media & Evidence</ion-label>
          </ion-item>                                                                                                                                                                                                                                                                                                                                                                                                                                
          <div slot="content" class="inner-content">
            <div class="media-flex">
              <div class="video-preview-card">
                <div class="v-icon">📹</div><h5 style="color: var(--dip-text-primary);">Webcam</h5>
                <div *ngIf="!attempt.recordings?.length" class="no-vid">No Video</div>
                <ion-button color="secondary" expand="block" *ngFor="let v of attempt.recordings" (click)="playVideo(v.video_file)">▶ PLAY</ion-button>
              </div>
              <div class="video-preview-card">
                <div class="v-icon">🖥️</div><h5 style="color: var(--dip-text-primary);">Screen</h5>
                <div *ngIf="!attempt.screen_recordings?.length" class="no-vid">No Recording</div>
                <ion-button color="tertiary" expand="block" *ngFor="let v of attempt.screen_recordings" (click)="playVideo(v.video_file)">▶ PLAY</ion-button>
              </div>
            </div>

            <!-- EVIDENCE SNAPSHOTS -->
            <div class="evidence-section" style="margin-top: 2rem; border-top: 2px dashed var(--dip-border); padding-top: 1.5rem;">
              <h4 style="color: var(--dip-brand-1); font-weight: 800; margin-bottom: 1rem;">📸 Violation Snapshots</h4>
              <div *ngIf="!attempt.evidence?.length" class="empty-txt">No visual evidence recorded for this session.</div>
              <div class="evidence-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px;">
                <div *ngFor="let ev of attempt.evidence" class="evidence-card" style="border: 1px solid var(--dip-border); border-radius: 8px; padding: 8px; background: var(--dip-bg-secondary); text-align: center;">
                  <div style="font-size: 0.75rem; font-weight: 800; color: var(--dip-brand-1); margin-bottom: 2px;">{{ ev.event_name | uppercase }}</div>
                  <div style="font-size: 0.7rem; color: var(--dip-text-secondary); margin-bottom: 8px;">{{ ev.timestamp | date:'hh:mm a' }}</div>
                  <div *ngIf="ev.camera_image_path" style="margin-bottom: 8px;">
                    <span style="font-size: 0.65rem; font-weight: bold; color: var(--dip-text-secondary);">WEBCAM</span>
                    <img [src]="apiUrl + '/uploads/' + ev.camera_image_path" style="width: 100%; border-radius: 6px; cursor: pointer; border: 1px solid var(--dip-border);" (click)="viewFullImage(ev.camera_image_path)">
                  </div>
                  <div *ngIf="ev.screen_image_path">
                    <span style="font-size: 0.65rem; font-weight: bold; color: var(--dip-text-secondary);">SCREEN</span>
                    <img [src]="apiUrl + '/uploads/' + ev.screen_image_path" style="width: 100%; border-radius: 6px; cursor: pointer; border: 1px solid var(--dip-border);" (click)="viewFullImage(ev.screen_image_path)">
                  </div>
                </div>
              </div>
            </div>
          </div>
        </ion-accordion>

        <!-- 4. PROCTORING ALERTS -->
        <ion-accordion value="logs" class="inner-acc">
          <ion-item slot="header" lines="none" style="--background: var(--dip-surface); --color: var(--dip-text-primary);"><ion-label style="font-weight: 700;">🛡️ Proctoring Alerts</ion-label></ion-item>
          <div slot="content" class="inner-content">
            <div *ngIf="!attempt.proctoring?.length" class="empty-txt">No suspicious activity detected.</div>
            <div *ngIf="attempt.proctoring?.length" class="grouped-events-list">
              <div *ngFor="let ev of groupProctoringEvents(attempt.proctoring); let i = index" class="grouped-event-row">
                <span class="event-index">{{ i + 1 }}.</span>
                <span class="event-name">{{ ev.display }}</span>
                <span class="event-count" [class.high]="ev.count >= 10" [class.medium]="ev.count >= 5 && ev.count < 10">{{ ev.count }} time{{ ev.count > 1 ? 's' : '' }}</span>
              </div>
            </div>
            <details *ngIf="attempt.proctoring?.length > 0" class="raw-timeline">
              <summary>📋 View raw timeline</summary>
              <div *ngFor="let ev of attempt.proctoring" class="log-entry">
                <div class="log-time">{{ ev.timestamp | date:'hh:mm a' }}</div>
                <div class="log-data">
                  <div class="log-title">⚠️ {{ ev.event | uppercase }}</div>
                  <div class="log-desc">{{ ev.detail }}</div>
                </div>
              </div>
            </details>
          </div>
        </ion-accordion>

        <!-- 5. SESSION LOGS -->
        <ion-accordion value="session_logs" class="inner-acc">
          <ion-item slot="header" lines="none" style="--background: var(--dip-surface); --color: var(--dip-text-primary);"><ion-label style="font-weight: 700;">📋 Session Activity</ion-label></ion-item>
          <div slot="content" class="inner-content">
            <div *ngIf="!attempt.session_logs?.length" class="empty-txt">No session logs found.</div>
            <div *ngFor="let log of attempt.session_logs" class="log-entry">
              <div class="log-time">{{ log.timestamp | date:'hh:mm a' }}</div>
              <div class="log-data">
                <div class="log-title">📌 {{ log.action | uppercase }}</div>
                <div class="log-desc">{{ log.details }}</div>
              </div>
            </div>
          </div>
        </ion-accordion>

      </ion-accordion-group>
    </ion-content>
  `,
  styles: [`
    .inner-acc { margin-bottom: 0.8rem; border-radius: 10px; border: 1px solid var(--dip-border); background: var(--dip-surface); overflow: hidden; }
    .inner-content { background: var(--dip-surface); padding: 1.2rem; }
    .res-box { text-align: center; padding: 1.5rem; border-radius: 16px; background: rgba(239, 68, 68, 0.1); border: 2px solid rgba(239, 68, 68, 0.3); }
    .res-box.pass { background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.3); }
    .score-display .val { font-size: 3rem; font-weight: 900; color: var(--dip-text-primary); }
    .score-display .total { font-size: 1.2rem; color: var(--dip-text-secondary); font-weight: 600; }
    .summary-txt { color: var(--dip-text-secondary); font-size: 0.95rem; margin: 10px 0 0; }
    .qa-card { background: var(--dip-bg-secondary); border: 1px solid var(--dip-border); border-radius: 12px; padding: 1rem; margin-bottom: 1rem; }
    .q-row { color: var(--dip-text-primary); font-weight: 800; margin-bottom: 8px; }
    .a-row { color: var(--dip-text-secondary); font-size: 0.9rem; line-height: 1.5; padding: 10px; background: var(--dip-surface); border-radius: 8px; border: 1px solid var(--dip-border); }
    .media-flex { display: flex; gap: 1rem; flex-wrap: wrap; }
    .video-preview-card { flex: 1; min-width: 200px; background: var(--dip-bg-secondary); border-radius: 12px; padding: 1.2rem; text-align: center; border: 1px solid var(--dip-border); }
    .v-icon { font-size: 2.5rem; margin-bottom: 10px; }
    .empty-txt { color: var(--dip-text-placeholder); text-align: center; font-style: italic; }
    .grouped-events-list { display: flex; flex-direction: column; gap: .5rem; margin-bottom: 1rem; }
    .grouped-event-row { display: flex; align-items: center; gap: .6rem; padding: .6rem .85rem; background: var(--dip-bg-secondary); border: 1px solid var(--dip-border); border-radius: 10px; border-left: 3px solid var(--dip-brand-1); }
    .event-index { font-weight: 800; font-size: .75rem; color: var(--dip-text-placeholder); }
    .event-name { flex: 1; font-size: .85rem; font-weight: 600; color: var(--dip-text-secondary); }
    .event-count { font-size: .75rem; font-weight: 800; padding: .2rem .55rem; border-radius: 6px; background: var(--dip-bg-tertiary); color: var(--dip-text-primary); }
    .log-entry { display: flex; gap: 15px; padding: 12px; margin-bottom: 10px; background: var(--dip-bg-secondary); border-radius: 10px; border: 1px solid var(--dip-border); }
    .log-time { color: var(--dip-brand-1); font-weight: 900; font-size: 0.85rem; }
    .log-title { color: var(--dip-danger); font-weight: 900; font-size: 0.95rem; }
    .log-desc { color: var(--dip-text-primary); font-size: 0.9rem; font-weight: 600; }
    .raw-timeline summary { font-size: .8rem; font-weight: 700; color: var(--dip-text-secondary); cursor: pointer; padding: .3rem 0; }
  `]
})
export class AttemptPreviewModalComponent {
  @Input() attempt: any;
  @Input() apiUrl!: string;

  constructor(private modalCtrl: ModalController, private alertCtrl: AlertController) {}

  close() {
    this.modalCtrl.dismiss();
  }

  async playVideo(filename: string) {
    const videoUrl = `${this.apiUrl}/uploads/${filename}`;
    const modal = await this.modalCtrl.create({
      component: VideoModalComponent,
      componentProps: { videoUrl, videoTitle: 'Recording Playback' }
    });
    await modal.present();
  }

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

  groupProctoringEvents(proctoring: any[]): EventCount[] {
    if (!proctoring?.length) return [];
    const counts: Record<string, number> = {};
    for (const ev of proctoring) {
      const clean = (ev.event || ev.type || 'unknown').toString().replace(/\s*\(WebSocket\)\s*/gi, '').replace(/\s+/g, '_').trim().toLowerCase();
      counts[clean] = (counts[clean] || 0) + 1;
    }
    const grouped = Object.entries(counts).map(([event, count]) => ({
      event, count, display: event.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    }));
    grouped.sort((a, b) => b.count - a.count);
    return grouped;
  }
}