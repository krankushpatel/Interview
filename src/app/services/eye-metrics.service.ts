// src/app/services/eye-metrics.service.ts

import { Injectable } from '@angular/core';
import { Point3D, GazeData, HeadPose, CalibrationResult } from '../models/eye-tracking.models';

// ✅ EXPORTED – so eye-tracking.service can import
export class OneEuroFilter {
  private lastTime = 0;
  private lastValue = 0;
  private lastDerivative = 0;

  constructor(
    private minCutoff = 1.0,
    private beta = 0.0,
    private dCutoff = 1.0
  ) {}

  filter(value: number, timestamp: number): number {
    if (this.lastTime === 0) {
      this.lastTime = timestamp;
      this.lastValue = value;
      return value;
    }
    const dt = Math.max((timestamp - this.lastTime) / 1000, 1e-6);
    this.lastTime = timestamp;

    const dx = (value - this.lastValue) / dt;
    const edx = this.alpha(dt, this.dCutoff) * dx + (1 - this.alpha(dt, this.dCutoff)) * this.lastDerivative;
    this.lastDerivative = edx;

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const out = this.alpha(dt, cutoff) * value + (1 - this.alpha(dt, cutoff)) * this.lastValue;
    this.lastValue = out;
    return out;
  }

  private alpha(dt: number, cutoff: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
}

@Injectable({ providedIn: 'root' })
export class EyeMetricsService {
  private readonly LEFT_EYE = [33, 160, 158, 133, 153, 144];
  private readonly RIGHT_EYE = [362, 385, 387, 263, 373, 380];
  private readonly LEFT_IRIS = 468;
  private readonly RIGHT_IRIS = 473;
  private readonly LEFT_EYE_CORNERS = { outer: 33, inner: 133 };
  private readonly RIGHT_EYE_CORNERS = { outer: 362, inner: 263 };
  private readonly LEFT_EYE_TB = { top: 159, bottom: 145 };
  private readonly RIGHT_EYE_TB = { top: 386, bottom: 374 };

  // Symmetric outer corners for head pose
  private readonly LANDMARK_INDICES = [1, 152, 33, 362, 61, 291];

  calculateEAR(landmarks: any[], side: 'left' | 'right'): number {
    const idx = side === 'left' ? this.LEFT_EYE : this.RIGHT_EYE;
    const p = idx.map(i => landmarks[i]);
    const v1 = this.dist(p[1], p[5]);
    const v2 = this.dist(p[2], p[4]);
    const h = this.dist(p[0], p[3]);
    if (h < 1e-6) return 0.3;
    return (v1 + v2) / (2 * h);
  }

  calculateGaze(landmarks: any[], calibration: CalibrationResult): GazeData {
    const leftIris = landmarks[this.LEFT_IRIS];
    const rightIris = landmarks[this.RIGHT_IRIS];

    // Horizontal (FIXED: mirror right eye so both ratios correlate)
    const leftHRange = landmarks[this.LEFT_EYE_CORNERS.inner].x - landmarks[this.LEFT_EYE_CORNERS.outer].x;
    const rightHRange = landmarks[this.RIGHT_EYE_CORNERS.inner].x - landmarks[this.RIGHT_EYE_CORNERS.outer].x;

    const leftHRatio = leftHRange === 0 ? 0.5 : (leftIris.x - landmarks[this.LEFT_EYE_CORNERS.outer].x) / leftHRange;
    const rightHRatio = rightHRange === 0 ? 0.5 : (landmarks[this.RIGHT_EYE_CORNERS.inner].x - rightIris.x) / rightHRange;

    let h = ((leftHRatio + rightHRatio) / 2 - 0.5) * 2 - calibration.gazeHOffset;

    // Vertical
    const leftVRange = landmarks[this.LEFT_EYE_TB.top].y - landmarks[this.LEFT_EYE_TB.bottom].y;
    const rightVRange = landmarks[this.RIGHT_EYE_TB.top].y - landmarks[this.RIGHT_EYE_TB.bottom].y;

    const leftVRatio = leftVRange === 0 ? 0.5 : (leftIris.y - landmarks[this.LEFT_EYE_TB.bottom].y) / leftVRange;
    const rightVRatio = rightVRange === 0 ? 0.5 : (rightIris.y - landmarks[this.RIGHT_EYE_TB.bottom].y) / rightVRange;

    let v = ((leftVRatio + rightVRatio) / 2 - 0.5) * 2 - calibration.gazeVOffset;

    h = Math.max(-1, Math.min(1, h));
    v = Math.max(-1, Math.min(1, v));

    return {
      horizontal: h,
      vertical: v,
      lookingAtScreen: Math.abs(h) < 0.45 && Math.abs(v) < 0.40 // will be overridden by service
    };
  }

  calculateHeadPose(landmarks: any[]): HeadPose {
    const nose = landmarks[this.LANDMARK_INDICES[0]];
    const chin = landmarks[this.LANDMARK_INDICES[1]];
    const leftEye = landmarks[this.LANDMARK_INDICES[2]];
    const rightEye = landmarks[this.LANDMARK_INDICES[3]];

    const eyeMidX = (leftEye.x + rightEye.x) / 2;
    const eyeMidY = (leftEye.y + rightEye.y) / 2; // FIX: use Y
    const eyeWidth = Math.abs(rightEye.x - leftEye.x);
    const yawDeg = Math.atan2(nose.x - eyeMidX, eyeWidth * 0.5) * 180 / Math.PI;

    const faceHeight = Math.abs(chin.y - eyeMidY);
    const expectedNoseY = eyeMidY + faceHeight * 0.25;
    const pitchDeg = Math.atan2(nose.y - expectedNoseY, faceHeight * 0.5) * 180 / Math.PI;

    const rollDeg = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * 180 / Math.PI;

    return { yaw: yawDeg, pitch: pitchDeg, roll: rollDeg };
  }

  private dist(a: Point3D, b: Point3D): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // FIX: vertical direction was inverted
  getGazeDirection(gaze: GazeData): 'left' | 'right' | 'up' | 'down' {
    if (Math.abs(gaze.horizontal) > Math.abs(gaze.vertical)) {
      return gaze.horizontal < 0 ? 'left' : 'right';
    } else {
      return gaze.vertical > 0 ? 'up' : 'down';
    }
  }
}