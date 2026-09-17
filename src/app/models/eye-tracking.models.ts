export interface Point3D { x: number; y: number; z: number; }

export interface GazeData {
  horizontal: number;
  vertical: number;
  lookingAtScreen: boolean;
}

export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface EyeTrackingMetrics {
  ear: { left: number; right: number; average: number };
  eyesClosed: boolean;
  closureDurationMs: number;
  gaze: GazeData;
  headPose: HeadPose;
  blinkRatePerMin: number;
  timestamp: number;
}

export type EyeViolationType = 'gaze_away_violation' | 'eye_closure_violation' | 'head_turned_violation' | 'abnormal_blink_violation';
export interface EyeViolationEvent {
  type: EyeViolationType;
  detail: string;
}

// ✅ NEW: Soft Warning Interface
export type EyeWarningType = 'gaze_away_warning' | 'eye_closure_warning';
export interface EyeWarningEvent {
  type: EyeWarningType;
  detail: string;
  direction: 'left' | 'right' | 'up' | 'down' | 'closed';
}

// ✅ NEW: Gaze Statistics for Result Page
export interface GazeStatistics {
  center: number;
  left: number;
  right: number;
  up: number;
  down: number;
  totalSamples: number;
}

export type DeviceTier = 'low' | 'mid' | 'high';
export interface CalibrationResult {
  baselineEar: number;
  gazeHOffset: number;
  gazeVOffset: number;
}