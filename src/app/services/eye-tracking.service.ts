// src/app/services/eye-tracking.service.ts

import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { EyeMetricsService, OneEuroFilter } from './eye-metrics.service';
import { EyeTrackingConfig, DEVICE_TIER_CONFIG } from '../config/eye-tracking.config';
import { DeviceTier, EyeTrackingMetrics, EyeViolationEvent, EyeWarningEvent, CalibrationResult, GazeStatistics, GazeData } from '../models/eye-tracking.models';

@Injectable({ providedIn: 'root' })
export class EyeTrackingService implements OnDestroy {
  private faceLandmarker: FaceLandmarker | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private isRunning = false;
  private isPaused = false;
  private frameCount = 0;
  private config: EyeTrackingConfig = DEVICE_TIER_CONFIG.mid;

  // Fixed filter parameters
  private earFilter = new OneEuroFilter(1.0, 0.0);
  private yawFilter = new OneEuroFilter(1.0, 0.5);
  private pitchFilter = new OneEuroFilter(1.0, 0.5);
  private gazeHFilter = new OneEuroFilter(1.0, 0.5);
  private gazeVFilter = new OneEuroFilter(1.0, 0.5);

  // State machines
  private eyesClosedSince: number | null = null;
  private gazeAwaySince: number | null = null;
  private gazeReturnSince: number | null = null;
  private headTurnedSince: number | null = null;
  private blinkTimestamps: number[] = [];
  private belowThresholdSince: number | null = null;

  // Tolerant grace period
  private gazeOnScreenStreak = 0;
  private readonly GAZE_RESET_STREAK = 3;

  // Warning cooldown & stats
  private lastWarningTime = 0;
  private gazeStats: GazeStatistics = { center: 0, left: 0, right: 0, up: 0, down: 0, totalSamples: 0 };

  private calibration: CalibrationResult = { baselineEar: 0.2, gazeHOffset: 0, gazeVOffset: 0 };

  // Settling flag (ignores events for first 5s)
  public isSettled = false;

  private metricsSubject = new BehaviorSubject<EyeTrackingMetrics | null>(null);
  private violationSubject = new BehaviorSubject<EyeViolationEvent | null>(null);
  private warningSubject = new BehaviorSubject<EyeWarningEvent | null>(null);

  constructor(private ngZone: NgZone, private metricsService: EyeMetricsService) {}

  get metrics$(): Observable<EyeTrackingMetrics | null> { return this.metricsSubject.asObservable(); }
  get violations$(): Observable<EyeViolationEvent | null> { return this.violationSubject.asObservable(); }
  get warnings$(): Observable<EyeWarningEvent | null> { return this.warningSubject.asObservable(); }

  public getCurrentMetrics(): EyeTrackingMetrics | null { return this.metricsSubject.value; }
  public getGazeStatistics(): GazeStatistics { return this.gazeStats; }

  public async initialize(video: HTMLVideoElement): Promise<void> {
    this.videoElement = video;
    this.detectDeviceTier();

    try {
      const vision = await FilesetResolver.forVisionTasks('/assets/mediapipe/wasm');
      this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/assets/mediapipe/face_landmarker.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false
      });
    } catch (error) {
      console.error('[EyeTracking] Failed to initialize MediaPipe:', error);
    }
  }

  public setVideoElement(video: HTMLVideoElement): void {
    this.videoElement = video;
    console.log('[EyeTracking] Video element swapped.');
  }

  public setCalibration(calibration: CalibrationResult): void {
    this.calibration = calibration;
    this.config.earClosureThreshold = calibration.baselineEar - 0.04;
  }

  public startTracking(): void {
    if (!this.faceLandmarker || !this.videoElement || this.isRunning) return;
    this.isRunning = true;
    this.gazeStats = { center: 0, left: 0, right: 0, up: 0, down: 0, totalSamples: 0 };
    this.ngZone.runOutsideAngular(() => this.loop());
  }

  public pauseTracking(): void { this.isPaused = true; }
  public resumeTracking(): void { this.isPaused = false; }

  public stopTracking(): void {
    this.isRunning = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.metricsSubject.next(null);
    this.violationSubject.next(null);
    this.warningSubject.next(null);
  }

  ngOnDestroy(): void {
    this.stopTracking();
    this.faceLandmarker?.close();
    this.faceLandmarker = null;
  }

  private detectDeviceTier(): void {
    const cores = navigator.hardwareConcurrency || 4;
    const mem = (navigator as any).deviceMemory || 4;
    if (cores <= 4 || mem <= 4) this.config = DEVICE_TIER_CONFIG.low;
    else if (cores <= 8) this.config = DEVICE_TIER_CONFIG.mid;
    else this.config = DEVICE_TIER_CONFIG.high;
  }

  private lastProcessTime = 0;
  // 4-5 FPS: Instantaneous eye/gaze proctoring detection without starving the GPU/compositor
  private readonly PROCESS_INTERVAL_MS = 220;

  private loop = (): void => {
    if (!this.isRunning || !this.videoElement || !this.faceLandmarker) return;

    if (this.videoElement.readyState >= 2 && !this.isPaused) {
      const now = performance.now();
      if (now - this.lastProcessTime >= this.PROCESS_INTERVAL_MS) {
        this.lastProcessTime = now;
        try {
          const results = this.faceLandmarker.detectForVideo(this.videoElement, now);
          this.processResults(results, now);
        } catch (e) {
          // ignore transient frame capture glitch
        }
      }
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  private processResults(results: any, now: number): void {
    if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
      this.metricsSubject.next(null);
      return;
    }

    const lm = results.faceLandmarks[0];

    // EAR
    const earLeft = this.metricsService.calculateEAR(lm, 'left');
    const earRight = this.metricsService.calculateEAR(lm, 'right');
    const earAvg = this.earFilter.filter((earLeft + earRight) / 2, now);

    const closed = earAvg < this.config.earClosureThreshold;
    if (closed && this.eyesClosedSince === null) this.eyesClosedSince = now;
    if (!closed) this.eyesClosedSince = null;
    const closureDuration = this.eyesClosedSince ? now - this.eyesClosedSince : 0;

    // Gaze
    let gaze = this.metricsService.calculateGaze(lm, this.calibration);
    gaze.horizontal = this.gazeHFilter.filter(gaze.horizontal, now);
    gaze.vertical = this.gazeVFilter.filter(gaze.vertical, now);
    gaze.lookingAtScreen =
      Math.abs(gaze.horizontal) < this.config.gazeHorizontalThreshold &&
      Math.abs(gaze.vertical) < this.config.gazeVerticalThreshold;

    // Head pose
    let headPose = this.metricsService.calculateHeadPose(lm);
    headPose.yaw = this.yawFilter.filter(headPose.yaw, now);
    headPose.pitch = this.pitchFilter.filter(headPose.pitch, now);

    // Grace period with streak
    if (!gaze.lookingAtScreen) {
      this.gazeOnScreenStreak = 0;
      if (this.gazeAwaySince === null) this.gazeAwaySince = now;
      this.gazeReturnSince = null;
    } else {
      this.gazeOnScreenStreak++;
      if (this.gazeOnScreenStreak >= this.GAZE_RESET_STREAK) {
        this.gazeAwaySince = null;
        this.gazeOnScreenStreak = 0;
      }
    }
    const gazeAwayDuration = this.gazeAwaySince ? now - this.gazeAwaySince : 0;

    const metrics: EyeTrackingMetrics = {
      ear: { left: earLeft, right: earRight, average: earAvg },
      eyesClosed: closed,
      closureDurationMs: closureDuration,
      gaze,
      headPose,
      blinkRatePerMin: 0,
      timestamp: now
    };

    // Keep metrics outside Angular zone so 60 FPS video renderer is NEVER interrupted
    this.metricsSubject.next(metrics);
    if (this.isSettled) {
      this.evaluateEvents(metrics, gazeAwayDuration, now);
    }
  }

  private updateGazeStats(gaze: GazeData, isClosed: boolean): void {
    if (isClosed) return;
    const threshold = 0.2;
    if (Math.abs(gaze.horizontal) < threshold && Math.abs(gaze.vertical) < threshold) {
      this.gazeStats.center++;
    } else if (Math.abs(gaze.horizontal) > Math.abs(gaze.vertical)) {
      if (gaze.horizontal < 0) this.gazeStats.left++; else this.gazeStats.right++;
    } else {
      if (gaze.vertical < 0) this.gazeStats.up++; else this.gazeStats.down++;
    }
    this.gazeStats.totalSamples++;
  }

  private evaluateEvents(m: EyeTrackingMetrics, gazeAwayDuration: number, now: number): void {
    // 1. Gaze away
    if (gazeAwayDuration >= this.config.gazeAwayWarningMs) {
      if (gazeAwayDuration >= this.config.gazeAwayViolationMs) {
        this.ngZone.run(() => {
          this.violationSubject.next({ type: 'gaze_away_violation', detail: 'Looked away for 15s+' });
        });
        this.gazeAwaySince = null;
        return;
      }
      if (now - this.lastWarningTime > 10000) {
        this.lastWarningTime = now;
        const dir = this.metricsService.getGazeDirection(m.gaze);
        this.ngZone.run(() => {
          this.warningSubject.next({ type: 'gaze_away_warning', detail: 'You are looking ' + dir + '. Please look at the center.', direction: dir });
        });
      }
      return;
    }

    // 2. Eye closure
    if (m.closureDurationMs >= this.config.eyeClosureWarningMs) {
      if (m.closureDurationMs >= this.config.eyeClosureViolationMs) {
        this.ngZone.run(() => {
          this.violationSubject.next({ type: 'eye_closure_violation', detail: 'Eyes closed for 10s+' });
        });
        this.eyesClosedSince = null;
        return;
      }
      if (now - this.lastWarningTime > 10000) {
        this.lastWarningTime = now;
        this.ngZone.run(() => {
          this.warningSubject.next({ type: 'eye_closure_warning', detail: 'Your eyes are closed. Please keep them open.', direction: 'closed' });
        });
      }
      return;
    }

    // 3. Head turn
    const isHeadTurned = Math.abs(m.headPose.yaw) > this.config.yawLimitDeg || Math.abs(m.headPose.pitch) > this.config.pitchLimitDeg;
    if (isHeadTurned) {
      if (this.headTurnedSince === null) this.headTurnedSince = now;
      const headTurnDuration = now - this.headTurnedSince;

      if (headTurnDuration >= this.config.headTurnViolationMs) {
        this.ngZone.run(() => {
          this.violationSubject.next({ type: 'head_turned_violation', detail: 'Head turned for 15s+' });
        });
        this.headTurnedSince = null;
        return;
      }
      if (headTurnDuration >= this.config.headTurnWarningMs && now - this.lastWarningTime > 10000) {
        this.lastWarningTime = now;
        const dir = m.headPose.yaw < -30 ? 'left' : m.headPose.yaw > 30 ? 'right' : m.headPose.pitch < -25 ? 'up' : 'down';
        this.ngZone.run(() => {
          this.warningSubject.next({ type: 'gaze_away_warning', detail: 'You are looking ' + dir + '. Please look at the center.', direction: dir });
        });
      }
    } else {
      this.headTurnedSince = null;
    }
  }
}
