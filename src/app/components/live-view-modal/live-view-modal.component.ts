import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-live-view-modal',
  standalone: true,
  imports: [CommonModule, IonicModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>🔴 Live View: {{ username }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="close()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding" style="background: #000;">
      <div class="live-grid">
        <!-- Camera Feed -->
        <div class="live-card">
          <div class="live-label">📹 LIVE CAMERA</div>
          <div class="live-frame">
            <img *ngIf="cameraFrame" [src]="cameraFrame" class="live-image" />
            <div *ngIf="!cameraFrame" class="loading">
              <ion-spinner name="crescent"></ion-spinner>
              <p>Waiting for camera feed...</p>
            </div>
          </div>
        </div>
        
        <!-- Screen Feed -->
        <div class="live-card">
          <div class="live-label">🖥️ LIVE SCREEN</div>
          <div class="live-frame">
            <img *ngIf="screenFrame" [src]="screenFrame" class="live-image" />
            <div *ngIf="!screenFrame" class="loading">
              <ion-spinner name="crescent"></ion-spinner>
              <p>Waiting for screen feed...</p>
            </div>
          </div>
        </div>
      </div>
      
      <div class="live-info">
        <div class="info-badge">
          <span class="dot active"></span>
          <span>Live Streaming</span>
        </div>
        <div class="info-text">
          Last update: {{ lastUpdate | date:'hh:mm:ss' }}
        </div>
      </div>
    </ion-content>
  `,
  styles: [`
    .live-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      height: calc(100% - 80px);
    }
    
    .live-card {
      background: #111;
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    
    .live-label {
      padding: 0.75rem;
      background: rgba(0,0,0,0.7);
      color: #fff;
      font-weight: 600;
      font-size: 0.85rem;
    }
    
    .live-frame {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #1a1a1a;
      min-height: 250px;
    }
    
    .live-image {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    
    .loading {
      text-align: center;
      color: #666;
    }
    
    .live-info {
      margin-top: 1rem;
      padding: 0.75rem;
      background: rgba(255,255,255,0.1);
      border-radius: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .info-badge {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #00e5a0;
    }
    
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #00e5a0;
      animation: pulse 1.5s infinite;
    }
    
    .info-text {
      color: #888;
      font-size: 0.75rem;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    
    @media (max-width: 768px) {
      .live-grid {
        grid-template-columns: 1fr;
        height: auto;
        gap: 1rem;
      }
      .live-frame {
        min-height: 200px;
      }
    }
  `]
})
export class LiveViewModalComponent implements OnInit, OnDestroy {
  @Input() username!: string;
  
  cameraFrame: string | null = null;
  screenFrame: string | null = null;
  lastUpdate: Date = new Date();
  
  private screenWs: WebSocket | null = null;
  private cameraWs: WebSocket | null = null;

  constructor(private modalCtrl: ModalController) {}

  ngOnInit() {
    // Connect to screen stream
    this.screenWs = new WebSocket(`${environment.wsUrl}/ws/view-screen/${this.username}`);
    this.screenWs.onmessage = (event) => {
      this.screenFrame = event.data;
      this.lastUpdate = new Date();
    };
    this.screenWs.onerror = (error) => {
      console.warn('Screen view unavailable');
    };

    // Connect to camera stream
    this.cameraWs = new WebSocket(`${environment.wsUrl}/ws/view-camera/${this.username}`);
    this.cameraWs.onmessage = (event) => {
      this.cameraFrame = event.data;
      this.lastUpdate = new Date();
    };
    this.cameraWs.onerror = (error) => {
      console.warn('Camera view unavailable');
    };
  }

  ngOnDestroy() {
    if (this.screenWs) this.screenWs.close();
    if (this.cameraWs) this.cameraWs.close();
  }

  close() {
    this.modalCtrl.dismiss();
  }
}