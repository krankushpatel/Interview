import { Component, OnInit, Input } from '@angular/core'; 
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, ToastController } from '@ionic/angular';
import { AdminService } from '../../services/admin.service';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

@Component({
  selector: 'app-add-student-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="modern-modal-container">
      
      <!-- Header -->
      <div class="modal-header">
        <h2 class="modal-title">Add New Student</h2>
        <button class="close-btn" (click)="dismiss()">✕</button>
      </div>

      <!-- Body Content -->
      <div class="modal-body">
        
        <!-- ========================================== -->
        <!-- STATE 1: CREATE FORM (Dikhayega jab tak create na ho) -->
        <!-- ========================================== -->
        <ng-container *ngIf="!result || !result.success">
          
          <div *ngIf="targetGroupName" class="info-banner">
            <span class="info-icon">ℹ️</span>
            This student will be automatically added to <strong>{{ targetGroupName }}</strong>.
          </div>

          <div class="form-group">
            <label class="input-label">Full Name *</label>
            <input type="text" class="custom-input" [(ngModel)]="name" placeholder="e.g. Ram" autofocus />
          </div>

          <div class="form-group">
            <label class="input-label">Email *</label>
            <input type="email" class="custom-input" [(ngModel)]="email" placeholder="e.g. ram@gmail.com" />
          </div>

          <label class="checkbox-wrap">
            <input type="checkbox" [(ngModel)]="sendEmail" class="custom-checkbox" />
            <span class="checkbox-text">Send login credentials via email</span>
          </label>
          
          <p class="email-hint" *ngIf="sendEmail">
            📧 An email will be sent to {{ email || 'the student' }} with username and password.
          </p>

          <div class="error-msg" *ngIf="error">
            ❌ {{ error }}
          </div>

          <div class="action-footer">
            <button class="btn-primary" [disabled]="!name || !email || loading" (click)="addStudent()">
              {{ loading ? 'Creating...' : 'Create Student' }}
            </button>
          </div>

        </ng-container>

        <!-- ========================================== -->
        <!-- STATE 2: SUCCESS VIEW (Form hide hone ke baad) -->
        <!-- ========================================== -->
        <ng-container *ngIf="result && result.success">
          <div class="success-header">
            <div class="success-icon">✅</div>
            <h3 class="success-title">Student Created Successfully!</h3>
            <div *ngIf="targetGroupName" class="auto-assign-badge">
              ✓ Auto-assigned to <strong>{{ targetGroupName }}</strong>
            </div>
          </div>

          <div class="credentials-box">
            <div class="cred-row">
              <span class="cred-label">👤 Name:</span>
              <span class="cred-value">{{ result.name }}</span>
            </div>
            <div class="cred-row">
              <span class="cred-label">📧 Email:</span>
              <span class="cred-value">{{ result.email }}</span>
            </div>
            <div class="cred-row" style="margin-top: 8px;">
              <span class="cred-label">🔑 Username:</span>
              <span class="cred-value highlight-text">{{ result.username }}</span>
            </div>
            <div class="cred-row">
              <span class="cred-label">🔒 Password:</span>
              <span class="cred-value highlight-text">{{ result.password }}</span>
            </div>
          </div>

          <div class="email-success-msg" *ngIf="sendEmail">
            <span *ngIf="result.email_sent">✓ Email sent successfully to {{ result.email }}</span>
            <span *ngIf="!result.email_sent" style="color: #b91c1c;">⚠️ Account created, but email could not be sent.</span>
          </div>

          <div class="action-footer double-btn">
            <button class="btn-outline" (click)="copyCredentials()">📋 Copy Credentials</button>
            <button class="btn-primary" (click)="dismiss()">Done</button>
          </div>
        </ng-container>

      </div>
    </div>
  `,
  styles: [`
    .modern-modal-container {
      background: #ffffff;
      width: 100%;
      height: auto;
      display: flex;
      flex-direction: column;
      font-family: inherit;
      color: #0f172a;
      border-radius: 16px;
      overflow: hidden;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 24px;
      border-bottom: 1px solid #e2e8f0;
      background: #ffffff;
    }
    .modal-title { margin: 0; font-size: 18px; font-weight: 700; color: #0f172a; }
    .close-btn { background: none; border: none; font-size: 16px; font-weight: 700; color: #64748b; cursor: pointer; padding: 4px; }
    .close-btn:hover { color: #0f172a; }

    .modal-body {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      overflow-y: auto;
    }

    .info-banner { background: #f0f9ff; border: 1px solid #bae6fd; color: #0369a1; padding: 12px; border-radius: 8px; font-size: 13px; display: flex; align-items: center; gap: 8px; }
    
    .form-group { display: flex; flex-direction: column; gap: 6px; }
    .input-label { font-size: 13px; font-weight: 700; color: #334155; }
    .custom-input { width: 100%; padding: 12px 14px; border-radius: 8px; border: 1px solid #cbd5e1; background: #f8fafc; color: #0f172a; font-size: 14px; outline: none; box-sizing: border-box; }
    .custom-input:focus { border-color: #2563eb; background: #ffffff; }

    .checkbox-wrap { display: flex; align-items: center; gap: 10px; cursor: pointer; margin-top: 4px; }
    .custom-checkbox { width: 18px; height: 18px; accent-color: #2563eb; cursor: pointer; }
    .checkbox-text { font-size: 14px; font-weight: 600; color: #334155; }
    .email-hint { margin: 0 0 0 28px; font-size: 12px; color: #64748b; }
    .error-msg { background: #fef2f2; color: #b91c1c; padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 600; text-align: center; }

    /* Success State */
    .success-header { text-align: center; margin-bottom: 8px; }
    .success-icon { font-size: 42px; margin-bottom: 12px; }
    .success-title { margin: 0 0 8px 0; color: #16a34a; font-size: 18px; font-weight: 800; }
    .auto-assign-badge { display: inline-block; background: #f0fdf4; color: #166534; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; border: 1px solid #bbf7d0; }

    .credentials-box { background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
    .cred-row { display: flex; align-items: center; font-size: 14px; }
    .cred-label { width: 90px; font-weight: 600; color: #64748b; }
    .cred-value { font-weight: 500; color: #0f172a; }
    .highlight-text { font-weight: 800; color: #2563eb; background: #eff6ff; padding: 2px 8px; border-radius: 4px; letter-spacing: 0.5px; }

    .email-success-msg { background: #f0fdf4; color: #15803d; padding: 10px; border-radius: 8px; font-size: 13px; text-align: center; font-weight: 600; }

    /* Buttons */
    .action-footer { margin-top: 8px; display: flex; gap: 12px; }
    .action-footer button { flex: 1; padding: 12px; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; border: none; }
    .btn-primary { background: #2563eb; color: #ffffff; }
    .btn-primary:hover:not(:disabled) { background: #1d4ed8; }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-outline { background: #ffffff; color: #334155; border: 1px solid #cbd5e1; }
    .btn-outline:hover { background: #f8fafc; }
  `]
})
export class AddStudentModalComponent implements OnInit {
  @Input() targetGroupId?: string;
  @Input() targetGroupName?: string;

  name = '';
  email = '';
  sendEmail = true;  
  maxAttempts = 1; 
  result: any = null;
  loading = false;
  error = '';

  constructor(
    private adminService: AdminService,
    private modalCtrl: ModalController,
    private toastCtrl: ToastController
  ) {}

  async ngOnInit() {
    try {
      const settings = await this.adminService.getExamSettings();
      if (settings && settings.max_attempts_default) {
        this.maxAttempts = settings.max_attempts_default;
      }
    } catch (err) {
      console.warn('Failed to load default settings, fallback to 1 attempt', err);
    }
  }

  async addStudent() {
    if (!this.name || !this.email) {
      this.showToast('Please fill all fields', 'warning');
      return;
    }
    
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(this.email)) {
      this.showToast('Please enter a valid email address', 'warning');
      return;
    }
    
    this.loading = true;
    this.error = '';
    this.result = null;
    
    try {
      this.result = await this.adminService.addStudent(this.name, this.email, this.sendEmail, this.maxAttempts);
      
      if (this.result.success) {
        if (this.targetGroupId) {
          try {
            await this.adminService.addStudentsToBatch(this.targetGroupId, [this.result.username]);
          } catch (groupErr) {
            console.error('Failed to auto-add to group', groupErr);
            this.showToast('Account created, but failed to add to group.', 'warning');
          }
        }
      } else {
        // 🟢 THE FIX: Backend 'error' key mein data bhej raha hai, isliye 'this.result.error' ko pehle check karo!
        this.error = this.result.error || this.result.message || 'Failed to create student';
      }
    } catch (err: any) {
      console.error(err);
      // 🟢 THE FIX: HTTP 400/500 errors ke case me bhi error key ko handle karo
      this.error = err.error?.error || err.error?.detail || err.error?.message || 'Failed to create student. Please try again.';
    } finally {
      this.loading = false;
    }
  }

  copyCredentials() {
    if (!this.result) return;
    const text = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 LOGIN CREDENTIALS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 Name: ${this.result.name}
🔑 Username: ${this.result.username}
🔒 Password: ${this.result.password}
🔗 Login Link: ${this.result.login_link}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    
    navigator.clipboard.writeText(text);
    this.showToast('Credentials copied to clipboard!', 'success');
  }

  async showToast(message: string, color: string = 'danger') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      position: 'bottom',
      color,
      buttons: [{ text: 'OK', role: 'cancel' }]
    });
    await toast.present();
  }

  dismiss() {
    const shouldRefresh = this.result && this.result.success ? true : false;
    this.modalCtrl.dismiss({ 
      refresh: shouldRefresh, 
      newUsername: this.result?.username 
    });
  }
}