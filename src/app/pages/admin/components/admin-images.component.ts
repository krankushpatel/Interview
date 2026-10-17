import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { AdminService } from '../../../services/admin.service';

@Component({
  selector: 'app-admin-images',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  template: `
    <div class="view active">
      <!-- Page Header -->
      <div class="page-header">
        <div>
          <h1 class="page-title">Image Manager</h1>
          <p class="page-subtitle">
            Upload question images. Copy filename and paste in your Excel bulk import file.
          </p>
        </div>
        <div class="stat-chip">{{ images.length }} image{{ images.length === 1 ? '' : 's' }}</div>
      </div>

      <!-- Instructions Banner -->
      <div class="info-banner">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 16v-4"/>
          <path d="M12 8h.01"/>
        </svg>
        <div>
          <strong>How to use:</strong>
          1. Upload images here →
          2. Click <strong>📋 Copy</strong> to get the filename →
          3. Paste filename in your Excel <code>Image</code> column →
          4. Bulk import questions.
        </div>
      </div>

      <!-- Upload Zone -->
      <div
        class="upload-zone"
        [class.uploading]="uploading"
        (drop)="onDrop($event)"
        (dragover)="onDragOver($event)"
      >
        <input
          #fileInput
          type="file"
          multiple
          accept=".png,.jpg,.jpeg"
          (change)="onFilesSelected($event)"
          hidden
        />

        <div class="upload-content" (click)="fileInput.click()">
          <div class="upload-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <h3>Drop images here or click to browse</h3>
          <p>Supports PNG, JPG, JPEG — Multiple files allowed</p>
          <p class="upload-hint">Max 5 MB per image · Filename preserved exactly as uploaded</p>
        </div>

        <div *ngIf="uploading" class="uploading-overlay">
          <div class="loading-spinner"></div>
          <p>Uploading images…</p>
        </div>
      </div>

      <!-- Search Bar -->
      <div class="search-bar" *ngIf="images.length > 0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          type="text"
          placeholder="Search by filename…"
          [(ngModel)]="searchQuery"
        />
        <span class="search-count">{{ filteredImages.length }} shown</span>
      </div>

      <!-- Image Grid -->
      <div class="images-grid" *ngIf="filteredImages.length > 0">
        <div class="image-card" *ngFor="let img of filteredImages">
          <div class="image-preview">
            <img
              [src]="getImageUrl(img.filename)"
              [alt]="img.filename"
              loading="lazy"
            />
          </div>
          <div class="image-info">
            <div class="filename" [title]="img.filename">{{ img.filename }}</div>
            <div class="meta">{{ img.size_kb }} KB</div>
          </div>
          <div class="image-actions">
            <button
              class="copy-btn"
              [class.copied]="copiedFilename === img.filename"
              (click)="copyFilename(img.filename)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              {{ copiedFilename === img.filename ? 'Copied!' : 'Copy' }}
            </button>
            <button class="delete-btn" (click)="deleteImage(img.filename)" title="Delete">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div class="empty-state" *ngIf="images.length === 0 && !uploading">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        <h3>No images uploaded yet</h3>
        <p>Drop images above or click to browse</p>
      </div>

      <!-- No Search Results -->
      <div class="empty-state" *ngIf="images.length > 0 && filteredImages.length === 0">
        <h3>No images match "{{ searchQuery }}"</h3>
        <p>Try a different search term</p>
      </div>
    </div>
  `,
  styles: [`
    .view { padding: 0; }

    .page-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }

    .page-title {
      font-size: 22px;
      font-weight: 700;
      color: var(--text-primary, #111827);
      letter-spacing: -0.5px;
      margin: 0;
    }

    .page-subtitle {
      font-size: 13.5px;
      color: var(--text-tertiary, #6b7280);
      margin: 4px 0 0;
    }

    .stat-chip {
      display: inline-flex;
      align-items: center;
      padding: 5px 12px;
      background: var(--bg-surface-2, #f3f4f6);
      border: 1px solid var(--border, #e5e7eb);
      border-radius: 999px;
      font-size: 12.5px;
      font-weight: 600;
      color: var(--text-secondary, #374151);
      font-family: monospace;
    }

    .info-banner {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 16px;
      background: rgba(79, 70, 229, 0.08);
      border: 1px solid rgba(79, 70, 229, 0.2);
      border-radius: 12px;
      font-size: 13px;
      color: #4f46e5;
      margin-bottom: 24px;
      line-height: 1.55;
    }
    .info-banner svg { flex-shrink: 0; margin-top: 2px; }
    .info-banner code {
      background: rgba(79, 70, 229, 0.15);
      padding: 1px 6px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
    }

    .upload-zone {
      position: relative;
      border: 2px dashed var(--border-strong, #d1d5db);
      border-radius: 16px;
      padding: 40px 24px;
      text-align: center;
      cursor: pointer;
      background: var(--bg-surface, #ffffff);
      transition: all 0.2s ease;
      margin-bottom: 24px;
    }
    .upload-zone:hover {
      border-color: #4f46e5;
      background: rgba(79, 70, 229, 0.04);
    }
    .upload-zone.uploading { pointer-events: none; opacity: 0.65; }

    .upload-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }
    .upload-content .upload-icon { color: #4f46e5; opacity: 0.7; }
    .upload-content h3 {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary, #111827);
      margin: 0;
    }
    .upload-content p {
      font-size: 13px;
      color: var(--text-tertiary, #6b7280);
      margin: 0;
    }
    .upload-content .upload-hint {
      font-size: 11.5px;
      opacity: 0.75;
      margin-top: 4px;
    }

    .uploading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(255, 255, 255, 0.9);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      border-radius: 16px;
    }
    .uploading-overlay p {
      font-size: 13px;
      font-weight: 600;
      color: #4f46e5;
      margin: 0;
    }

    .loading-spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(79, 70, 229, 0.2);
      border-top-color: #4f46e5;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .search-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      background: var(--bg-surface, #ffffff);
      border: 1px solid var(--border, #e5e7eb);
      border-radius: 12px;
      margin-bottom: 16px;
    }
    .search-bar svg { color: var(--text-tertiary, #6b7280); flex-shrink: 0; }
    .search-bar input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      font-family: inherit;
      font-size: 13.5px;
      color: var(--text-primary, #111827);
    }
    .search-bar input::placeholder { color: var(--text-tertiary, #6b7280); }
    .search-bar .search-count {
      font-size: 12px;
      color: var(--text-tertiary, #6b7280);
      font-family: monospace;
    }

    .images-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
    }

    .image-card {
      background: var(--bg-surface, #ffffff);
      border: 1px solid var(--border, #e5e7eb);
      border-radius: 14px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: all 0.2s ease;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    }
    .image-card:hover {
      border-color: #4f46e5;
      box-shadow: 0 4px 20px rgba(79, 70, 229, 0.15);
      transform: translateY(-2px);
    }

    .image-preview {
      width: 100%;
      aspect-ratio: 1 / 1;
      background: var(--bg-surface-2, #f3f4f6);
      border-radius: 10px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .image-preview img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .image-info { display: flex; flex-direction: column; gap: 3px; padding: 0 4px; }
    .filename {
      font-size: 11.5px;
      font-family: monospace;
      font-weight: 600;
      color: var(--text-primary, #111827);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .meta { font-size: 11px; color: var(--text-tertiary, #6b7280); font-family: monospace; }

    .image-actions { display: flex; gap: 6px; }

    .copy-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 7px 10px;
      background: rgba(79, 70, 229, 0.1);
      color: #4f46e5;
      border: 1px solid rgba(79, 70, 229, 0.25);
      border-radius: 8px;
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .copy-btn:hover { background: #4f46e5; color: #ffffff; }
    .copy-btn.copied { background: #10b981; color: #ffffff; border-color: #10b981; }

    .delete-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 7px 10px;
      background: transparent;
      color: #dc2626;
      border: 1px solid rgba(220, 38, 38, 0.25);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .delete-btn:hover { background: #dc2626; color: #ffffff; }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 24px;
      text-align: center;
      color: var(--text-tertiary, #6b7280);
    }
    .empty-state svg { margin-bottom: 16px; opacity: 0.35; }
    .empty-state h3 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-secondary, #374151);
      margin: 0 0 6px;
    }
    .empty-state p { font-size: 13.5px; margin: 0; }

    @media (max-width: 768px) {
      .images-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
      .upload-zone { padding: 28px 16px; }
    }
  `]
})
export class AdminImagesComponent implements OnInit {
  images: any[] = [];
  uploading = false;
  copiedFilename: string | null = null;
  searchQuery = '';

 // ✅ NEW: Image ratio validation config (must match backend image_handler.py)
//   readonly STANDARD_RATIO = { w: 16, h: 9 };  // <-- YAHAN CHANGE KARO
//   readonly RATIO_TOLERANCE = 0.3;  

  constructor(
    private adminService: AdminService,
    private toastCtrl: ToastController,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    await this.loadImages();
  }

  async loadImages() {
    try {
      const res = await this.adminService.getAdminImages();
      this.images = res.images || [];
      this.cdr.markForCheck();
    } catch (e) {
      console.error('Failed to load images', e);
      await this.showToast('Failed to load images', 'danger');
    }
  }

  get filteredImages(): any[] {
    if (!this.searchQuery.trim()) return this.images;
    const q = this.searchQuery.toLowerCase();
    return this.images.filter(img => img.filename.toLowerCase().includes(q));
  }

  onFilesSelected(event: any) {
    const files: FileList = event.target.files;
    if (files && files.length > 0) {
      this.uploadFiles(Array.from(files));
    }
    event.target.value = '';
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.uploadFiles(Array.from(files));
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  async uploadFiles(files: File[]) {
    this.uploading = true;
    try {
      const res = await this.adminService.uploadAdminImages(files);
      if (res.count > 0) {
        await this.showToast(`${res.count} image(s) uploaded successfully`, 'success');
      }
      if (res.failed?.length > 0) {
        const failedNames = res.failed.map((f: any) => f.filename || f.original_name).join(', ');
        await this.showToast(`${res.failed.length} file(s) failed: ${failedNames}`, 'warning');
      }
      await this.loadImages();
    } catch (e: any) {
      console.error('Upload failed', e);
      await this.showToast(e?.error?.detail || 'Upload failed', 'danger');
    } finally {
      this.uploading = false;
      this.cdr.markForCheck();
    }
  }

  async copyFilename(filename: string) {
    try {
      await navigator.clipboard.writeText(filename);
      this.copiedFilename = filename;
      await this.showToast(`Copied: ${filename}`, 'success');
      setTimeout(() => {
        this.copiedFilename = null;
        this.cdr.markForCheck();
      }, 2000);
    } catch (e) {
      await this.showToast('Failed to copy', 'danger');
    }
  }

  async deleteImage(filename: string) {
    if (!confirm(`Delete "${filename}"?\n\nThis cannot be undone.`)) return;
    try {
      const res = await this.adminService.deleteAdminImage(filename);
      if (res.was_in_use_by > 0) {
        await this.showToast(
          `Deleted, but this image was used by ${res.was_in_use_by} question(s)`,
          'warning'
        );
      } else {
        await this.showToast('Image deleted', 'success');
      }
      await this.loadImages();
    } catch (e: any) {
      await this.showToast(e?.error?.detail || 'Delete failed', 'danger');
    }
  }

  getImageUrl(filename: string): string {
    return this.adminService.getAdminImageUrl(filename);
  }

  private async showToast(message: string, color: string = 'primary') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3500,
      position: 'bottom',
      color,
    });
    await toast.present();
  }
}