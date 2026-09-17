import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

@Component({
  selector: 'app-video-modal',
  standalone: true,
  imports: [CommonModule, IonicModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ videoTitle }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="video-wrapper">
        <video controls autoplay style="width:100%; max-height: 70vh;">
          <source [src]="videoUrl" type="video/webm">
          Your browser does not support the video tag.
        </video>
      </div>
    </ion-content>
  `,
  styles: [`
    .video-wrapper {
      display: flex;
      justify-content: center;
      align-items: center;
      background: #000;
      border-radius: 8px;
      overflow: hidden;
    }
    video {
      width: 100%;
      max-height: 70vh;
      outline: none;
    }
  `]
})
export class VideoModalComponent {
  @Input() videoUrl!: string;
  @Input() videoTitle!: string;

  constructor(private modalCtrl: ModalController) {}

  dismiss() {
    this.modalCtrl.dismiss();
  }
}