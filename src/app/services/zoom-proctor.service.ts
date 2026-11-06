import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { MeetingService } from './meeting.service';

export interface ZoomSessionInfo {
  session_name: string;
  user_identity: string;
  token: string;
  sdk_key: string;
  role: number;
}

@Injectable({
  providedIn: 'root'
})
export class ZoomProctorService {
  // Connection states
  public isConnected$ = new BehaviorSubject<boolean>(false);
  public isAudioActive$ = new BehaviorSubject<boolean>(false);
  public isVideoActive$ = new BehaviorSubject<boolean>(false);
  public isScreenActive$ = new BehaviorSubject<boolean>(false);
  public isAdminTalking$ = new BehaviorSubject<boolean>(false);
  public sessionInfo$ = new BehaviorSubject<ZoomSessionInfo | null>(null);
  public lastError$ = new BehaviorSubject<string | null>(null);

  // Hidden audio element on student side for Admin Intercom audio
  private studentAudioEl: HTMLAudioElement | null = null;
  private currentUsername: string = '';
  private currentRole: 'student' | 'admin' | null = null;

  constructor(private meetingService: MeetingService) {}

  // ════════════════════════════════════════════════════════
  // 1. STUDENT SILENT BACKGROUND SESSION (Zero UI)
  // ════════════════════════════════════════════════════════
  async startStudentSession(
    username: string,
    cameraStream?: MediaStream,
    screenStream?: MediaStream
  ): Promise<boolean> {
    try {
      this.currentUsername = username;
      this.currentRole = 'student';

      console.log(`[ZoomProctor] Initializing silent student session for: ${username}`);

      // 1. Request session token from backend (role: 0 = Student Silent Broadcaster)
      const res = await this.meetingService.getZoomSessionToken(username, 0);
      if (!res || !res.success || !res.token) {
        console.warn('[ZoomProctor] Token generation returned unsuccessful response', res);
        return false;
      }

      const info: ZoomSessionInfo = {
        session_name: res.session_name,
        user_identity: username,
        token: res.token,
        sdk_key: res.sdk_key,
        role: 0
      };
      this.sessionInfo$.next(info);

      // 2. Setup invisible intercom receiver for incoming Admin voice
      this.ensureStudentAudioReceiver();

      this.isConnected$.next(true);
      if (cameraStream) this.isVideoActive$.next(true);
      if (screenStream) this.isScreenActive$.next(true);

      console.log(`[ZoomProctor] ✅ Silent session established. Session: ${res.session_name}`);
      return true;
    } catch (err: any) {
      console.warn('[ZoomProctor] Silent student session init failed (non-blocking):', err);
      this.lastError$.next(err?.message || 'Failed to start Zoom silent session');
      return false;
    }
  }

  // ════════════════════════════════════════════════════════
  // 2. ADMIN LIVE MONITOR SESSION (Same-tab Embedded Modal)
  // ════════════════════════════════════════════════════════
  async startAdminSession(username: string): Promise<ZoomSessionInfo | null> {
    try {
      this.currentUsername = username;
      this.currentRole = 'admin';

      console.log(`[ZoomProctor] Provisioning Admin session for candidate: ${username}`);

      // 1. Request session token from backend (role: 1 = Admin Proctor Host)
      const res = await this.meetingService.getZoomSessionToken(username, 1);
      if (!res || !res.success || !res.token) {
        throw new Error('Could not obtain Zoom Admin session token.');
      }

      const info: ZoomSessionInfo = {
        session_name: res.session_name,
        user_identity: 'admin_proctor',
        token: res.token,
        sdk_key: res.sdk_key,
        role: 1
      };

      this.sessionInfo$.next(info);
      this.isConnected$.next(true);
      return info;
    } catch (err: any) {
      console.error('[ZoomProctor] Admin session failed:', err);
      this.lastError$.next(err?.message || 'Admin session error');
      return null;
    }
  }

  // Admin toggles intercom speaking to student
  setAdminTalking(talking: boolean) {
    this.isAdminTalking$.next(talking);
  }

  // Hidden audio element on student page so Admin voice can be heard without showing any media player
  private ensureStudentAudioReceiver() {
    if (this.studentAudioEl) return;
    try {
      this.studentAudioEl = document.createElement('audio');
      this.studentAudioEl.id = 'zoom-silent-intercom-receiver';
      this.studentAudioEl.autoplay = true;
      (this.studentAudioEl as any).playsInline = true;
      this.studentAudioEl.style.position = 'absolute';
      this.studentAudioEl.style.left = '-9999px';
      this.studentAudioEl.style.width = '1px';
      this.studentAudioEl.style.height = '1px';
      this.studentAudioEl.style.opacity = '0';
      document.body.appendChild(this.studentAudioEl);
    } catch (e) {
      console.warn('[ZoomProctor] Audio receiver element creation warning:', e);
    }
  }

  // ════════════════════════════════════════════════════════
  // 3. CLEAN DISCONNECT
  // ════════════════════════════════════════════════════════
  leaveSession() {
    console.log('[ZoomProctor] Leaving session...');
    this.isConnected$.next(false);
    this.isAudioActive$.next(false);
    this.isVideoActive$.next(false);
    this.isScreenActive$.next(false);
    this.isAdminTalking$.next(false);
    this.sessionInfo$.next(null);

    if (this.studentAudioEl) {
      try {
        this.studentAudioEl.pause();
        this.studentAudioEl.srcObject = null;
        this.studentAudioEl.remove();
      } catch (e) {}
      this.studentAudioEl = null;
    }
  }
}

