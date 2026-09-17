// src/app/config/eye-tracking.config.ts

export interface EyeTrackingConfig {
  processEveryNthFrame: number;
  earClosureThreshold: number;
  yawLimitDeg: number;
  pitchLimitDeg: number;
  gazeHorizontalThreshold: number;
  gazeVerticalThreshold: number;
  gazeAwayWarningMs: number;
  gazeAwayViolationMs: number;
  eyeClosureWarningMs: number;
  eyeClosureViolationMs: number;
  headTurnWarningMs: number;
  headTurnViolationMs: number;
}

export type DeviceTier = 'low' | 'mid' | 'high';

export const DEVICE_TIER_CONFIG: Record<DeviceTier, EyeTrackingConfig> = {
  low: {
    processEveryNthFrame: 3,
    earClosureThreshold: 0.20,
    yawLimitDeg: 35,
    pitchLimitDeg: 30,
    gazeHorizontalThreshold: 0.60,
    gazeVerticalThreshold: 0.55,
    gazeAwayWarningMs: 5000,
    gazeAwayViolationMs: 15000,
    eyeClosureWarningMs: 5000,
    eyeClosureViolationMs: 10000,
    headTurnWarningMs: 6000,
    headTurnViolationMs: 15000
  },
  mid: {
    processEveryNthFrame: 2,
    earClosureThreshold: 0.22,
    yawLimitDeg: 30,
    pitchLimitDeg: 25,
    gazeHorizontalThreshold: 0.60,
    gazeVerticalThreshold: 0.55,
    gazeAwayWarningMs: 5000,
    gazeAwayViolationMs: 15000,
    eyeClosureWarningMs: 5000,
    eyeClosureViolationMs: 10000,
    headTurnWarningMs: 6000,
    headTurnViolationMs: 15000
  },
  high: {
    processEveryNthFrame: 1,
    earClosureThreshold: 0.23,
    yawLimitDeg: 25,
    pitchLimitDeg: 20,
    gazeHorizontalThreshold: 0.60,
    gazeVerticalThreshold: 0.55,
    gazeAwayWarningMs: 5000,
    gazeAwayViolationMs: 15000,
    eyeClosureWarningMs: 5000,
    eyeClosureViolationMs: 10000,
    headTurnWarningMs: 6000,
    headTurnViolationMs: 15000
  }
};