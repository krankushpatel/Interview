import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-proctoring-logs-modal',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>🛡️ Proctoring Logs – {{ studentName }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="close()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="logs-header">
        <span>🔴 Live updates every 3 seconds</span>
        <ion-button size="small" fill="clear" (click)="refresh()">
          <ion-icon name="refresh-outline"></ion-icon> Refresh
        </ion-button>
      </div>
      
      <div *ngIf="events.length === 0" class="empty-state">
        <ion-icon name="shield-outline"></ion-icon>
        <p>No proctoring events yet.</p>
        <p class="empty-sub">When student performs any violation, events will appear here.</p>
      </div>
      
      <div class="log-list">
        <div *ngFor="let event of events" class="log-item" [ngClass]="getEventClass(event.event)">
          <div class="log-time">{{ event.timestamp | date:'hh:mm:ss' }}</div>
          <div class="log-event">
            <strong>{{ event.event | uppercase }}</strong>
            <span class="log-detail" *ngIf="event.detail">{{ event.detail }}</span>
          </div>
        </div>
      </div>
      
      <div class="log-footer" *ngIf="events.length > 0">
        Total events: {{ events.length }}
      </div>
    </ion-content>
  `,
  styles: [`
    .logs-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--ion-color-medium);
      font-size: 0.8rem;
      color: var(--ion-color-medium);
    }
    .log-list {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      max-height: 60vh;
      overflow-y: auto;
    }
    .log-item {
      padding: 0.6rem 0.8rem;
      border-radius: 8px;
      background: rgba(255,255,255,0.05);
      border-left: 4px solid transparent;
    }
    .log-item.warning {
      border-left-color: #f59e0b;
      background: rgba(245,158,11,0.1);
    }
    .log-item.critical {
      border-left-color: #ef4444;
      background: rgba(239,68,68,0.1);
    }
    .log-time {
      font-size: 0.7rem;
      color: var(--ion-color-medium);
      font-family: monospace;
    }
    .log-event {
      font-size: 0.85rem;
      margin-top: 0.2rem;
    }
    .log-detail {
      color: var(--ion-color-medium);
      margin-left: 0.5rem;
      font-size: 0.75rem;
    }
    .empty-state {
      text-align: center;
      padding: 2rem;
      color: var(--ion-color-medium);
    }
    .empty-sub {
      font-size: 0.7rem;
      margin-top: 0.5rem;
    }
    .log-footer {
      margin-top: 1rem;
      padding-top: 0.5rem;
      border-top: 1px solid rgba(255,255,255,0.1);
      font-size: 0.75rem;
      text-align: center;
      color: var(--ion-color-medium);
    }
  `]
})
export class ProctoringLogsModalComponent implements OnInit, OnDestroy {
  @Input() username!: string;
  @Input() studentName!: string;
  
  events: any[] = [];
  private pollingInterval: any;
  
  constructor(
    private http: HttpClient,
    private modalCtrl: ModalController
  ) {}
  
  ngOnInit() {
    this.refresh();
    // Poll every 3 seconds
    this.pollingInterval = setInterval(() => {
      this.refresh();
    }, 3000);
  }
  
  ngOnDestroy() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
  }
  
  async refresh() {
    try {
      const res = await this.http.get<any>(`${environment.apiUrl}/proctoring/live-proctoring/${this.username}`).toPromise();
      this.events = res.events || [];
    } catch (err) {
      console.error('Failed to fetch proctoring logs', err);
    }
  }
  
  getEventClass(eventName: string): string {
    const critical = ['tab_switch', 'window_blur', 'devtools_attempt', 'copy_attempt', 'fullscreen_exit'];
    if (critical.includes(eventName)) return 'critical';
    return 'warning';
  }
  
  close() {
    this.modalCtrl.dismiss();
  }
}