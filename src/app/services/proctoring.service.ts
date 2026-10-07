import { Injectable, NgZone } from '@angular/core';
import * as faceapi from 'face-api.js';

export interface ProctorWarning {
  type: string;
  message: string;
  count: number;
  remaining: number;
}

export interface ProctorEvent {
  time: string;
  event: string;
  timestamp: number;
  detail?: string;
  event_id?: string;   // unique per event -> backend skips duplicates (immediate log vs end-of-exam bulk store)
}

@Injectable({ providedIn: 'root' })
export class ProctoringService {
  private events: ProctorEvent[] = [];
  private warningCount = 0;
  public maxWarnings = 5;
  private startTime = Date.now();
  private active = false;
  private isFullscreen = false;
  private noFaceTimer: any = null;
  private noFaceCountdownTimer: any = null;
  private noFaceSecondsLeft = 0;
  private noFaceTriggerDelay = 10;
  private faceDetectionInterval: any = null;
  private videoElement: HTMLVideoElement | null = null;
  public faceModelsLoaded = false;  // 👈 made public so student.page.ts can check

  private lastWarningTime = new Map<string, number>();
  private readonly WARNING_COOLDOWN_MS = 4000;
  private readonly ALERT_COOLDOWN_MS = 4000;

  private consecutiveNoFace = 0;
  private consecutiveMultiFace = 0;
  private readonly CONSECUTIVE_THRESHOLD = 5;
  private multipleFaceCount = 0;
  private readonly MULTIPLE_FACE_THRESHOLD = 3;

  private originalWindowOpen: any;
  private isBlockingActive = false;
  private fullscreenRetryInterval: any = null;
  private isScreenShareDialogOpen = false;
  private screenShareDialogTimer: any = null;
  private lastAspectRatio = 0;
  private splitScreenWarningCount = 0;
  private lastPrintScreenTime = 0;

  private onWarningCallback?: (warning: ProctorWarning) => void;
  private onTerminateCallback?: (info: any) => void;
  private onEventCallback?: (event: ProctorEvent) => void;
  private onFaceAlertCallback?: (msg: string) => void;
  private onNoFaceCountdownCallback?: (secondsLeft: number) => void;
  private violationCounters = new Map<string, number>();

  constructor(private ngZone: NgZone) {}

  start(onWarning?: any, onTerminate?: any, onEvent?: any, onFaceAlert?: any, onNoFaceCountdown?: any) {
    if (this.active) return;
    this.active = true;
    this.startTime = Date.now();
    this.isFullscreen = !!(document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).mozFullScreenElement);
    this.loadCountersFromStorage();
    this.onWarningCallback = onWarning;
    this.onTerminateCallback = onTerminate;
    this.onEventCallback = onEvent;
    this.onFaceAlertCallback = onFaceAlert;
    this.onNoFaceCountdownCallback = onNoFaceCountdown;
    this.attachEventListeners();
    this.requestFullscreen();
    this.enableHardwareBlocking();
    this.startFullscreenMonitor();
    this.preventTabClose();
    this.enableTabWindowBlocking();
    this.startSplitScreenDetection();
    this.startAppSwitcherDetection();
    this.startScreenshotDetection();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.detachEventListeners();
    this.stopFaceDetection();
    this.disableHardwareBlocking();
    this.stopFullscreenMonitor();
    this.restoreTabClose();
    this.disableTabWindowBlocking();
    this.stopSplitScreenDetection();
    this.stopAppSwitcherDetection();
    this.stopScreenshotDetection();
    this.disallowScreenShareDialog();
  }

  public allowScreenShareDialog() {
    this.isScreenShareDialogOpen = true;
    if (this.screenShareDialogTimer) clearTimeout(this.screenShareDialogTimer);
    this.screenShareDialogTimer = setTimeout(() => {
      this.isScreenShareDialogOpen = false;
      this.screenShareDialogTimer = null;
    }, 60_000);
  }

  public disallowScreenShareDialog() {
    setTimeout(() => {
      this.isScreenShareDialogOpen = false;
      if (this.screenShareDialogTimer) {
        clearTimeout(this.screenShareDialogTimer);
        this.screenShareDialogTimer = null;
      }
    }, 2000);
  }

  private enableTabWindowBlocking() {
    if (this.isBlockingActive) return;
    this.isBlockingActive = true;
    this.originalWindowOpen = window.open;
    window.open = this.blockedWindowOpen;
    document.addEventListener('auxclick', this.onAuxClick);
    document.addEventListener('click', this.onCtrlClick, true);
    document.addEventListener('click', this.onShiftClick, true);
    document.addEventListener('keydown', this.onTabBlockKeyDown);
    window.addEventListener('keydown', this.onExtraKeyBlock);
    document.addEventListener('keydown', this.onFunctionKeyBlock);
  }

  private disableTabWindowBlocking() {
    this.isBlockingActive = false;
    if (this.originalWindowOpen) window.open = this.originalWindowOpen;
    document.removeEventListener('auxclick', this.onAuxClick);
    document.removeEventListener('click', this.onCtrlClick, true);
    document.removeEventListener('click', this.onShiftClick, true);
    document.removeEventListener('keydown', this.onTabBlockKeyDown);
    window.removeEventListener('keydown', this.onExtraKeyBlock);
    document.removeEventListener('keydown', this.onFunctionKeyBlock);
  }

  private blockedWindowOpen = (url?: string | URL, target?: string, features?: string): Window | null => {
    if (this.active) {
      this.handleViolation('new_window_attempt', 'Attempted to open new window via JavaScript');
      return null;
    }
    return this.originalWindowOpen?.call(window, url, target, features) || null;
  };

  private onAuxClick = (e: MouseEvent): void => {
    if (e.button === 1 && this.active) {
      e.preventDefault();
      e.stopPropagation();
      this.handleViolation('new_tab_attempt', 'Middle click (opens new tab)');
    }
  };

  private onCtrlClick = (e: MouseEvent): void => {
    if ((e.ctrlKey || e.metaKey) && this.active) {
      e.preventDefault();
      e.stopPropagation();
      this.handleViolation('new_tab_attempt', 'Ctrl+Click (opens new tab)');
    }
  };

  private onShiftClick = (e: MouseEvent): void => {
    if (e.shiftKey && this.active) {
      e.preventDefault();
      e.stopPropagation();
      this.handleViolation('new_window_attempt', 'Shift+Click (opens new window)');
    }
  };

  private onExtraKeyBlock = (e: KeyboardEvent): void => {
    if (!this.active) return;
    if (e.altKey && e.key === 'Enter') {
      e.preventDefault();
      this.handleViolation('fullscreen_toggle_attempt', 'Alt+Enter (Fullscreen toggle)');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'e')) {
      e.preventDefault();
      this.handleViolation('search_attempt', 'Ctrl+K/E (Browser search)');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
      e.preventDefault();
      this.handleViolation('address_bar_attempt', 'Ctrl+L (Address bar)');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
      e.preventDefault();
      this.handleViolation('history_attempt', 'Ctrl+H (History)');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
      e.preventDefault();
      this.handleViolation('downloads_attempt', 'Ctrl+J (Downloads)');
      return;
    }
  };

  private onFunctionKeyBlock = (e: KeyboardEvent): void => {
    if (!this.active) return;
    if (e.key === 'F11') { e.preventDefault(); this.handleViolation('fullscreen_toggle_attempt', 'F11 (Fullscreen)'); return; }
    if (e.key === 'F1')  { e.preventDefault(); this.handleViolation('help_attempt', 'F1 (Help)'); return; }
    if (e.key === 'F3')  { e.preventDefault(); this.handleViolation('find_attempt', 'F3 (Find)'); return; }
  };

  private onTabBlockKeyDown = (e: KeyboardEvent): void => {
    if (!this.active) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 't') { e.preventDefault(); this.handleViolation('new_tab_attempt', 'Ctrl+T (New Tab)'); return; }
    if (ctrl && k === 'n') { e.preventDefault(); this.handleViolation('new_window_attempt', 'Ctrl+N (New Window)'); return; }
    if (ctrl && k === 'w') { e.preventDefault(); this.handleViolation('close_tab_attempt', 'Ctrl+W (Close Tab)'); return; }
    if (ctrl && e.shiftKey && k === 't') { e.preventDefault(); this.handleViolation('reopen_tab_attempt', 'Ctrl+Shift+T'); return; }
    if (ctrl && e.key === 'Tab') { e.preventDefault(); this.handleViolation('next_tab_attempt', 'Ctrl+Tab'); return; }
    if (ctrl && e.shiftKey && e.key === 'Tab') { e.preventDefault(); this.handleViolation('prev_tab_attempt', 'Ctrl+Shift+Tab'); return; }
    if (e.altKey && e.key === 'Tab') { e.preventDefault(); this.handleViolation('alt_tab_detected', 'Alt+Tab'); return; }
    if (e.metaKey && e.key === 'Tab') { e.preventDefault(); this.handleViolation('cmd_tab_detected', 'Cmd+Tab'); return; }
    if (ctrl && k === 'f') { e.preventDefault(); this.handleViolation('find_attempt', 'Ctrl+F blocked'); return; }
    if (ctrl && k === 'p') { e.preventDefault(); this.handleViolation('print_attempt', 'Ctrl+P blocked'); return; }
    if (ctrl && k === 's') { e.preventDefault(); this.handleViolation('save_attempt', 'Ctrl+S blocked'); return; }
    if (e.key === 'F5' || (ctrl && k === 'r')) { e.preventDefault(); this.handleViolation('refresh_attempt', 'Page refresh blocked'); return; }
    if (ctrl && e.shiftKey && k === 'r') { e.preventDefault(); this.handleViolation('refresh_attempt', 'Hard refresh blocked'); return; }
  };

  private startFullscreenMonitor() {
    this.fullscreenRetryInterval = setInterval(() => {
      const isCurrentlyFull = !!(document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).mozFullScreenElement);
      if (this.active && !isCurrentlyFull && this.isFullscreen && !this.isScreenShareDialogOpen) {
        this.onFullscreenChange();
      }
    }, 1000);
  }

  private stopFullscreenMonitor() {
    if (this.fullscreenRetryInterval) {
      clearInterval(this.fullscreenRetryInterval);
      this.fullscreenRetryInterval = null;
    }
  }

  private preventTabClose() { window.addEventListener('beforeunload', this.onBeforeUnload); }
  private restoreTabClose() { window.removeEventListener('beforeunload', this.onBeforeUnload); }

  private onBeforeUnload = (e: BeforeUnloadEvent): string | undefined => {
    if (this.active) {
      e.preventDefault();
      e.returnValue = '';
      this.handleViolation('tab_close_attempt', 'Attempted to close tab');
      return '';
    }
    return undefined;
  };

  private enableHardwareBlocking() {
    document.body.style.userSelect = 'none';
    (document.body.style as any).webkitUserSelect = 'none';
    document.querySelectorAll('img').forEach(img => img.setAttribute('draggable', 'false'));
  }

  private disableHardwareBlocking() {
    document.body.style.userSelect = '';
    (document.body.style as any).webkitUserSelect = '';
  }

  requestFullscreen() {
    const docEl = document.documentElement;
    const req = docEl.requestFullscreen || (docEl as any).webkitRequestFullscreen || (docEl as any).mozRequestFullScreen;
    if (req) {
      req.call(docEl)
        .then(() => {
          this.isFullscreen = true;
        })
        .catch((err: any) => console.warn('[Proctor] Fullscreen request failed:', err));
    }
  }

  isFullScreenMode(): boolean {
    return !!(document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).mozFullScreenElement);
  }

  // private handleViolation(type: string, message: string) {
  //   if (!this.active || this.isScreenShareDialogOpen) return;
  //   const now = Date.now();
  //   const last = this.lastWarningTime.get(type) || 0;
  //   if (now - last > 1000) this.logEvent(type, message);
  //   if (now - last < this.WARNING_COOLDOWN_MS) return;
  //   this.lastWarningTime.set(type, now);
  //   this.warningCount++;
  //   const remaining = Math.max(0, this.maxWarnings - this.warningCount);
  //   const warning: ProctorWarning = { type, message, count: this.warningCount, remaining };
  //   if (this.onWarningCallback) this.onWarningCallback(warning);
  //   if (this.warningCount >= this.maxWarnings) {
  //     this.terminate('max_warnings_reached', `Exceeded maximum violations (${this.maxWarnings})`);
  //   }
  // }

  private handleViolation(type: string, message: string) {
    if (!this.active || this.isScreenShareDialogOpen) return;

    // Increment local counter for threshold tracking
    const currentCount = (this.violationCounters.get(type) || 0) + 1;
    this.violationCounters.set(type, currentCount);

    this.saveCountersToStorage();

    const now = Date.now();
    const last = this.lastWarningTime.get(type) || 0;

    // Classification filters
    const isCritical = [
      'tab_switch', 'fullscreen_exit', 'devtools_attempt', 
      'multiple_faces_detected', 'multiple_speakers_detected', 
      'split_screen_detected', 'app_switcher_detected', 'screenshot_attempt'
    ].includes(type);

    const isThresholdNuisance = [
      'copy_attempt', 'cut_attempt', 'paste_detected', 'right_click'
    ].includes(type);

    // Log event locally if critical or if threshold (> 10 times) is crossed for nuisances
    if (now - last > 1000) {
      if (isCritical || !isThresholdNuisance || currentCount > 10) {
        this.logEvent(type, message);
      }
    }

    if (now - last < this.WARNING_COOLDOWN_MS) return;
    this.lastWarningTime.set(type, now);

    // Formal warning strikes count towards termination only for critical items or breached thresholds
    if (isCritical || (isThresholdNuisance && currentCount > 10)) {
      this.warningCount++;
      const remaining = Math.max(0, this.maxWarnings - this.warningCount);
      const warning: ProctorWarning = { type, message, count: this.warningCount, remaining };
      if (this.onWarningCallback) this.onWarningCallback(warning);
      if (this.warningCount >= this.maxWarnings) {
        this.terminate('max_warnings_reached', `Exceeded maximum violations (${this.maxWarnings})`);
      }
    } else {
      // Show local warning block message without adding to global strike count
      if (this.onFaceAlertCallback) {
        this.onFaceAlertCallback(`⚠️ Action Blocked: ${message}. Please do not repeat.`);
      }
    }
  }



  private terminate(type: string, reason: string) {
    if (!this.active) return;
    this.active = false;
    this.logEvent(type, reason);
    if (this.onTerminateCallback) this.onTerminateCallback({ type, reason, events: this.events });
  }

  private attachEventListeners() {
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    // window.addEventListener('blur', this.onWindowBlur);
    // window.addEventListener('focus', this.onWindowFocus);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', this.onFullscreenChange);
    document.addEventListener('mozfullscreenchange', this.onFullscreenChange);
    document.addEventListener('copy', this.onCopy);
    document.addEventListener('cut', this.onCut);
    document.addEventListener('paste', this.onPaste);
    document.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('beforeprint', this.onPrint);
  }

  private detachEventListeners() {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    // window.removeEventListener('blur', this.onWindowBlur);
    // window.removeEventListener('focus', this.onWindowFocus);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', this.onFullscreenChange);
    document.removeEventListener('mozfullscreenchange', this.onFullscreenChange);
    document.removeEventListener('copy', this.onCopy);
    document.removeEventListener('cut', this.onCut);
    document.removeEventListener('paste', this.onPaste);
    document.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('beforeprint', this.onPrint);
  }

  private onVisibilityChange = (): void => {
    if (this.isScreenShareDialogOpen) return;
    if (document.hidden) this.handleViolation('tab_switch', 'Switched to another tab');
    else this.logEvent('tab_return');
  };

  // private onWindowBlur = (): void => {
  //   if (this.isScreenShareDialogOpen) return;
  //   this.handleViolation('window_blur', 'Left interview window');
  // };

  // private onWindowFocus = (): void => this.logEvent('window_focus');
  private onFullscreenChange = (): void => {
    const nowFull = !!(document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).mozFullScreenElement);
    if (!nowFull && this.isFullscreen && !this.isScreenShareDialogOpen) {
      this.handleViolation('fullscreen_exit', 'Exited fullscreen mode');
    }
    this.isFullscreen = nowFull;
  };
  private onCopy = (e: Event): void => { e.preventDefault(); this.handleViolation('copy_attempt', 'Attempted to copy'); };
  private onCut = (e: Event): void => { e.preventDefault(); this.logEvent('cut_attempt'); };
  private onPaste = (): void => this.logEvent('paste_detected');
  private onContextMenu = (e: Event): void => { e.preventDefault(); this.logEvent('right_click'); };
  private onPrint = (): void => this.handleViolation('print_attempt', 'Attempted to print');
  private onKeyDown = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && 'ijcIJC'.includes(e.key)) {
      e.preventDefault();
      this.handleViolation('devtools_attempt', 'Tried to open DevTools');
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
      e.preventDefault();
      this.logEvent('view_source_attempt');
    }
  };

  public logEvent(eventType: string, detail: string = '') {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    const ev: ProctorEvent = { time: `${m}:${s}`, event: eventType, timestamp: Date.now(), detail, event_id: this.newEventId() };
    this.events.push(ev);
    if (this.onEventCallback) this.onEventCallback(ev);
  }

  private newEventId(): string {
    const c: any = typeof crypto !== 'undefined' ? crypto : null;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private startSplitScreenDetection() {
    this.lastAspectRatio = window.innerWidth / window.innerHeight;
    window.addEventListener('resize', this.onSplitScreenResize);
  }

  private stopSplitScreenDetection() {
    window.removeEventListener('resize', this.onSplitScreenResize);
  }

  private onSplitScreenResize = () => {
    if (!this.active) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspectRatio = width / height;
    const isNormalPhoneRatio = aspectRatio > 1.3 && aspectRatio < 2.5;
    const isSplitScreen = !isNormalPhoneRatio && (width < 600 || height < 400);
    const ratioChange = Math.abs(aspectRatio - this.lastAspectRatio) / this.lastAspectRatio;
    if ((isSplitScreen || ratioChange > 0.3) && this.active) {
      this.handleViolation('split_screen_detected', `Split screen detected. Aspect ratio: ${aspectRatio.toFixed(2)}`);
      this.splitScreenWarningCount++;
    }
    this.lastAspectRatio = aspectRatio;
  };

  private startAppSwitcherDetection() {
    document.addEventListener('visibilitychange', this.onAppSwitcherVisibility);
    window.addEventListener('pagehide', this.onAppSwitcherPageHide);
    document.addEventListener('freeze', this.onAppSwitcherFreeze);
  }

  private stopAppSwitcherDetection() {
    document.removeEventListener('visibilitychange', this.onAppSwitcherVisibility);
    window.removeEventListener('pagehide', this.onAppSwitcherPageHide);
    document.removeEventListener('freeze', this.onAppSwitcherFreeze);
  }

  private onAppSwitcherVisibility = () => {
    if (!this.active || this.isScreenShareDialogOpen) return;
    if (document.hidden) this.handleViolation('app_switcher_detected', 'App switcher or background app detected');
  };
  private onAppSwitcherPageHide = (e: PageTransitionEvent) => {
    if (!this.active) return;
    if (e.persisted === undefined || !e.persisted) {
      this.handleViolation('app_switcher_detected', 'App switcher or navigation detected');
    }
  };
  private onAppSwitcherFreeze = () => {
    if (!this.active) return;
    this.handleViolation('app_switcher_detected', 'App went to background');
  };

  private startScreenshotDetection() {
    window.addEventListener('keyup', this.onScreenshotKeyUp);
    window.addEventListener('keydown', this.onScreenshotKeyDown);
    document.addEventListener('fullscreenchange', this.onScreenshotFullscreenChange);
  }

  private stopScreenshotDetection() {
    window.removeEventListener('keyup', this.onScreenshotKeyUp);
    window.removeEventListener('keydown', this.onScreenshotKeyDown);
    document.removeEventListener('fullscreenchange', this.onScreenshotFullscreenChange);
  }

  private onScreenshotKeyUp = (e: KeyboardEvent) => {
    if (!this.active) return;
    const now = Date.now();
    const isPrint = e.key === 'PrintScreen' || e.key === 'Print Screen' || e.code === 'PrintScreen';
    if (isPrint && now - this.lastPrintScreenTime > 5000) {
      this.lastPrintScreenTime = now;
      this.handleViolation('screenshot_attempt', 'PrintScreen key pressed');
    }
  };
  private onScreenshotKeyDown = (e: KeyboardEvent) => {
    if (!this.active) return;
    if (e.key === 'PrintScreen' || e.key === 'Print Screen' || e.code === 'PrintScreen') {
      e.preventDefault();
    }
  };
  private onScreenshotFullscreenChange = () => {
    if (!this.active || this.isScreenShareDialogOpen) return;
    const now = Date.now();
    if (now - this.lastPrintScreenTime < 1000) return;
    if (!document.fullscreenElement && this.isFullscreen) {
      this.logEvent('possible_screenshot', 'Possible screenshot taken (fullscreen change)');
    }
  };

  async startFaceDetection(videoEl: HTMLVideoElement) {
    this.videoElement = videoEl;
    await this.loadFaceModels();
    if (this.faceModelsLoaded) {
      this.faceDetectionInterval = setInterval(() => this.detectFaces(), 500);
    } else {
      console.warn('[Proctor] Face models not loaded, using pixel variance fallback');
      this.startPixelVarianceFallback();
    }
  }

  public async loadFaceModels() {
    try {
      // 🟢 FIX: Ab yeh direct public folder se uthayega
      const modelPath = '/models'; 
      
      await faceapi.nets.tinyFaceDetector.loadFromUri(modelPath);
      await faceapi.nets.faceLandmark68Net.loadFromUri(modelPath);
      await faceapi.nets.faceRecognitionNet.loadFromUri(modelPath);
      
      console.log('[Proctor] Models loaded locally from', modelPath);
      this.faceModelsLoaded = true;
    } catch (err) {
      console.error('[Proctor] Model load failed', err);
      this.faceModelsLoaded = false;
    }
  }

  private async detectFaces() {
    if (!this.videoElement || this.videoElement.readyState < 2) {
      // ✅ DIAGNOSTIC: uncomment when debugging "detection not working"
      console.log('[Proctor] detectFaces SKIP — readyState:', this.videoElement?.readyState);
      return;
    }
    try {
      const detections = await faceapi.detectAllFaces(
        this.videoElement,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.35 })
      );
      const videoW = this.videoElement.videoWidth || 320;
      const videoH = this.videoElement.videoHeight || 240;
      const minFaceArea = (videoW * videoH) * 0.008;
      const validFaces = detections.filter((d: any) => (d.box.width * d.box.height) >= minFaceArea);
      const faceCount = validFaces.length;

      // ✅ DIAGNOSTIC: uncomment when debugging
      // console.log(`[Proctor] detectFaces — faceCount: ${faceCount}, active: ${this.active}, multiCount: ${this.multipleFaceCount}`);

      const faceEl = document.getElementById('face-count');
      if (faceEl) faceEl.textContent = String(faceCount);

      if (faceCount > 1) {
        this.consecutiveMultiFace++;
        this.consecutiveNoFace = 0;
        this.triggerMultiFaceWarning(faceCount);
        this.clearNoFaceTimer();
        if (this.onFaceAlertCallback) this.onFaceAlertCallback(`⚠ Multiple faces (${faceCount}) detected!`);
      } else if (faceCount === 0) {
        this.consecutiveNoFace++;
        this.consecutiveMultiFace = 0;
        if (this.consecutiveNoFace >= this.CONSECUTIVE_THRESHOLD) {
          this.handleNoFace();
        }
      } else {
        this.consecutiveNoFace = 0;
        this.consecutiveMultiFace = 0;
        this.clearNoFaceTimer();
        if (this.onFaceAlertCallback) this.onFaceAlertCallback('✅ Face OK');
      }
    } catch (err) {
      console.error('[Proctor] Face detection error:', err);
    }
  }

  // private triggerMultiFaceWarning(faceCount: number) {
  //   const now = Date.now();
  //   const last = this.lastWarningTime.get('multiple_faces_detected') || 0;
  //   if (now - last < this.WARNING_COOLDOWN_MS) return;
  //   this.lastWarningTime.set('multiple_faces_detected', now);
  //   this.warn('multiple_faces_detected', `${faceCount} faces detected`);
  // }

  private triggerMultiFaceWarning(faceCount: number) {
    const now = Date.now();
    const last = this.lastWarningTime.get('multiple_faces_detected') || 0;
    // Keep 4s cooldown so 1 sustained "2 faces" event = 1 strike (not 20)
    if (now - last < this.WARNING_COOLDOWN_MS) return;
    this.lastWarningTime.set('multiple_faces_detected', now);

    // ✅ DEDICATED counter — does NOT touch global warningCount
    this.multipleFaceCount++;
    const remaining = Math.max(0, this.MULTIPLE_FACE_THRESHOLD - this.multipleFaceCount);
    const message = `${faceCount} faces detected (${this.multipleFaceCount}/${this.MULTIPLE_FACE_THRESHOLD})`;

    // ✅ ALWAYS log to proctor event log (visible in proctor panel + sent to server)
    this.logEvent('multiple_faces_detected', message);
    console.warn(`[Proctor] ⚠ ${message}`);

    // ✅ Fire warning callback → shows toast + warning modal in student.page.ts
    if (this.onWarningCallback) {
      const warning: ProctorWarning = {
        type: 'multiple_faces_detected',
        message,
        count: this.multipleFaceCount,
        remaining
      };
      this.onWarningCallback(warning);
    }

    // ✅ TERMINATE at 3 strikes — independent of global warningCount
    if (this.multipleFaceCount >= this.MULTIPLE_FACE_THRESHOLD) {
      this.terminate(
        'multiple_faces_terminated',
        `Terminated after ${this.multipleFaceCount} multiple-face violations`
      );
    }
  }

  private handleNoFace() {
    if (!this.noFaceTimer) {
      this.noFaceTimer = setTimeout(() => this.startNoFaceCountdown(), this.noFaceTriggerDelay * 1000);
    }
    const now = Date.now();
    const lastAlert = this.lastWarningTime.get('no_face_alert') || 0;
    if (now - lastAlert > this.ALERT_COOLDOWN_MS) {
      this.lastWarningTime.set('no_face_alert', now);
      if (this.onFaceAlertCallback) this.onFaceAlertCallback('No face detected – please look at camera');
    }
    const lastWarn = this.lastWarningTime.get('no_face_detected') || 0;
    if (now - lastWarn > this.WARNING_COOLDOWN_MS) {
      this.lastWarningTime.set('no_face_detected', now);
      this.warn('no_face_detected', 'Face missing from camera');
    }
  }

  private startNoFaceCountdown() {
    this.noFaceSecondsLeft = this.noFaceTriggerDelay;
    if (this.onNoFaceCountdownCallback) this.onNoFaceCountdownCallback(this.noFaceSecondsLeft);
    this.noFaceCountdownTimer = setInterval(() => {
      this.noFaceSecondsLeft--;
      if (this.onNoFaceCountdownCallback) this.onNoFaceCountdownCallback(this.noFaceSecondsLeft);
      if (this.noFaceSecondsLeft <= 0) {
        clearInterval(this.noFaceCountdownTimer);
        this.noFaceCountdownTimer = null;
        this.terminate('no_face_prolonged', 'No face for extended period');
      }
    }, 1000);
  }

  private clearNoFaceTimer() {
    if (this.noFaceTimer) { clearTimeout(this.noFaceTimer); this.noFaceTimer = null; }
    if (this.noFaceCountdownTimer) { clearInterval(this.noFaceCountdownTimer); this.noFaceCountdownTimer = null; }
    if (this.onNoFaceCountdownCallback) this.onNoFaceCountdownCallback(-1);
  }

  private startPixelVarianceFallback() {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.faceDetectionInterval = setInterval(() => {
      if (!this.videoElement || this.videoElement.readyState < 2) return;
      try {
        ctx.drawImage(this.videoElement, 0, 0, 160, 120);
        const imgData = ctx.getImageData(0, 0, 160, 120);
        let sum = 0;
        for (let i = 0; i < imgData.data.length; i += 4) sum += (imgData.data[i] + imgData.data[i+1] + imgData.data[i+2]) / 3;
        const mean = sum / (imgData.data.length / 4);
        let variance = 0;
        for (let i = 0; i < imgData.data.length; i += 4) {
          const v = (imgData.data[i] + imgData.data[i+1] + imgData.data[i+2]) / 3 - mean;
          variance += v * v;
        }
        variance /= (imgData.data.length / 4);
        if (variance < 200) this.handleNoFace();
        else { this.clearNoFaceTimer(); if (this.onFaceAlertCallback) this.onFaceAlertCallback('✅ Face OK (fallback)'); }
      } catch (err) {}
    }, 2000);
  }

  private stopFaceDetection() {
    if (this.faceDetectionInterval) clearInterval(this.faceDetectionInterval);
    this.clearNoFaceTimer();
  }

  getEvents() { return this.events; }
  getWarningCount() { return this.warningCount; }

  reset() {
    this.events = [];
    this.warningCount = 0;
    this.multipleFaceCount = 0;
    this.lastWarningTime.clear();
    this.violationCounters.clear();
    sessionStorage.removeItem('proctor_violation_counters');
    this.consecutiveNoFace = 0;
    this.consecutiveMultiFace = 0;
    this.clearNoFaceTimer();
    if (this.faceDetectionInterval) clearInterval(this.faceDetectionInterval);
  }

  private warn(type: string, message: string) {
    if (!this.active) return;
    this.warningCount++;
    this.logEvent(type, message);
    const remaining = Math.max(0, this.maxWarnings - this.warningCount);
    const warning: ProctorWarning = { type, message, count: this.warningCount, remaining };
    if (this.onWarningCallback) this.onWarningCallback(warning);
    if (this.warningCount >= this.maxWarnings) {
      this.terminate('max_warnings_reached', `Exceeded maximum violations (${this.maxWarnings})`);
    }
  }

  // Load counters from sessionStorage when service starts
  private loadCountersFromStorage() {
    const stored = sessionStorage.getItem('proctor_violation_counters');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        this.violationCounters = new Map(Object.entries(parsed));
      } catch (e) {
        console.warn('Failed to parse stored counters', e);
      }
    }
  }

  // Save counters to sessionStorage whenever they update
  private saveCountersToStorage() {
    const obj = Object.fromEntries(this.violationCounters);
    sessionStorage.setItem('proctor_violation_counters', JSON.stringify(obj));
  }

}
