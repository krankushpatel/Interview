import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { Submission } from '../../services/admin.service';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

@Component({
  selector: 'app-submission-modal',
  standalone: true,
  imports: [CommonModule, IonicModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ submission.student_name }}'s Submission</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-list>
        <ion-item>
          <ion-label><strong>Student:</strong> {{ submission.student_name }} (@{{ submission.username }})</ion-label>
        </ion-item>
        <ion-item>
          <ion-label><strong>Submitted At:</strong> {{ submission.submitted_at | date:'medium' }}</ion-label>
        </ion-item>
        <ion-item>
          <ion-label><strong>Category:</strong> {{ submission.question_category }}</ion-label>
        </ion-item>
        <ion-item>
          <ion-label><strong>Question:</strong></ion-label>
        </ion-item>
        <ion-item>
          <div class="question-text">{{ submission.question_text }}</div>
        </ion-item>
        <ion-item>
          <ion-label><strong>Answer:</strong></ion-label>
        </ion-item>
        <ion-item>
          <div class="answer-text">{{ submission.answer }}</div>
        </ion-item>
        <ion-item *ngIf="submission.has_video">
          <ion-label><strong>Video:</strong> {{ submission.video_file }}</ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  `,
  styles: [`
    .question-text, .answer-text {
      white-space: pre-wrap;
      padding: 8px 0;
      line-height: 1.5;
    }
  `]
})
export class SubmissionModalComponent {
  @Input() submission!: Submission;
  constructor(private modalCtrl: ModalController) {}
  dismiss() { this.modalCtrl.dismiss(); }
}