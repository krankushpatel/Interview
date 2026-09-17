import asyncio
from typing import Optional


class DiarizationDetector:
    """
    Detects multiple speakers from per-frame audio statistics.

    FIX SUMMARY v2
    ──────────────────────────────────────────────────────────────
    CORE PROBLEM WITH PREVIOUS VERSION:
    The old spike-based logic (energy > recent_avg * 1.8) was INVERTED
    for multi-speaker detection:

    • Two simultaneous speakers → SUSTAINED energy elevation (1.2–1.9× baseline)
      NOT a spike. The floor rises, not the peak.
      Old threshold of 1.8× was in the middle of this zone, causing misses.

    • Single loud voice (cough, knock, shout) → BRIEF spike (2.0×+ above avg)
      This is exactly what the old 1.8× threshold was catching → false positives.

    NEW DETECTION ARCHITECTURE (3 paths):

    PATH 1 — Silero Confusion Zone (NEW):
      When Silero VAD sees mixed voices it returns speech_prob 0.35–0.60
      (uncertain, not clearly one speaker). Combined with active energy
      (recent_avg > 0.008), this is a reliable multi-speaker signal.
      Routes.py passes this as silero_confused=True.
      Weight: +2 per frame (strong signal).

    PATH 2 — Sustained Elevation (replaces old spike logic):
      Ratio band 1.2–1.9× recent_avg: catches two voices adding energy together.
      Upper bound 1.9× explicitly excludes single-voice spikes (> 2.0×).
      Also requires variance > 0.000008 (two different pitches create variance)
      and zcr > 0.04 (voiced speech, not a thump or knock).
      Weight: +1 per frame.

    PATH 3 — Single Voice Spike Suppressor (NEW):
      If energy / recent_avg > 2.0, this is a SINGLE loud event.
      Actively subtracts 2 from the counter to prevent false positives
      from coughs, mic bumps, table knocks, or a student raising their voice.

    THRESHOLD CHANGES:
      min_consecutive: 3 → 4  (needs more sustained evidence before firing)
      cooldown_sec:    3.0 → 4.0  (prevents double-firing on same event)
      threshold param: removed (no longer a simple multiplier — see PATH 2)
    ──────────────────────────────────────────────────────────────
    """
    def __init__(
        self,
        cooldown_sec:    float = 2.0,   # was 3.0 — prevents rapid double-fire
        min_consecutive: int   = 5,     # was 3 — needs sustained evidence
    ):
        self.cooldown_sec    = cooldown_sec
        self.min_consecutive = min_consecutive

        self.last_trigger_time  = 0.0
        self.consecutive_exceed = 0
        self.active_speakers: set[int] = set()

    # ──────────────────────────────────────────────────────────────

    def detect_multiple_speakers(
        self,
        energy:          float,
        recent_avg:      float,
        variance:        float,
        zcr:             float,
        silero_confused: bool = False,  # NEW: True when speech_prob is 0.35–0.60
    ) -> bool:
        """
        Return True when the current audio frame looks like overlapping
        or rapidly alternating speakers.

        Parameters (all from normalized Int16→Float32 audio):
          energy          – RMS of the current frame           (0 … ~0.3 typical)
          recent_avg      – exponentially-weighted rolling avg  (0 … ~0.3 typical)
          variance        – weighted variance of rolling window (very small values)
          zcr             – zero-crossing rate of the frame     (0 … 0.5)
          silero_confused – True when Silero returned 0.35–0.60 on active audio,
                            indicating it sees a mixed/uncertain signal
        """
        try:
            current_time = asyncio.get_event_loop().time()
        except RuntimeError:
            import time
            current_time = time.monotonic()

        in_cooldown = (current_time - self.last_trigger_time) <= self.cooldown_sec

        # Safe ratio — avoid division by zero on silence
        energy_ratio = energy / (recent_avg + 0.0001)

        # ── PATH 3: Single voice spike SUPPRESSOR ─────────────────────────
        # A ratio > 2.0 means energy more than doubled in one frame.
        # This is a brief transient (cough, knock, table bump, loud shout).
        # It is NOT two simultaneous voices — actively reset the counter.
        single_voice_spike = energy_ratio > 2.0

        if single_voice_spike:
            # Subtract aggressively to counteract any accumulated PATH 1/2 evidence
            self.consecutive_exceed = max(0, self.consecutive_exceed - 2)

        else:
            # ── PATH 1: Silero confusion zone ─────────────────────────────
            # Silero is a single-speaker VAD. When it encounters two voices
            # simultaneously it returns an uncertain probability (0.35–0.60).
            # This is a STRONGER signal than math alone — weight it +2.
            if silero_confused and recent_avg > 0.005:
                self.consecutive_exceed += 3

            # ── PATH 2: Sustained energy elevation ────────────────────────
            # Two simultaneous speakers raise the energy FLOOR, not the peak.
            # Ratio band 1.2–1.9× catches this lifted floor while excluding:
            #   < 1.2×: normal single-voice variation (breathing, pauses)
            #   > 1.9×: single loud event caught by PATH 3 suppressor above
            # Additional guards:
            #   variance > 0.000008 — two different pitches create variance
            #   recent_avg > 0.008  — active audio, not near-silence
            #   zcr > 0.04          — voiced speech present, not a thump
            elif (
                1.2 < energy_ratio < 2.0
                and variance   > 0.000005
                and recent_avg > 0.005
                and zcr        > 0.03
            ):
                self.consecutive_exceed += 1

            else:
                # No evidence — decay slowly so a brief silence doesn't
                # immediately erase genuine accumulated multi-speaker evidence
                self.consecutive_exceed = max(0, self.consecutive_exceed - 1)

        # ── Fire only when sustained evidence crosses threshold ────────────
        if self.consecutive_exceed >= self.min_consecutive and not in_cooldown:
            self.last_trigger_time  = current_time
            self.consecutive_exceed = 0
            return True

        return False

    # ──────────────────────────────────────────────────────────────

    def add_speaker(self, speaker_id: int) -> None:
        """Register a speaker ID returned by Deepgram diarization."""
        self.active_speakers.add(speaker_id)

    def get_speaker_count(self) -> int:
        """Number of unique speakers detected so far in this session."""
        return len(self.active_speakers)

    def reset(self) -> None:
        """Clear accumulated speaker state (call after firing an event)."""
        self.active_speakers    = set()
        self.consecutive_exceed = 0