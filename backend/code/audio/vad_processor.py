import os
os.environ["TORCH_USE_NNPACK"] = "0"
os.environ["TORCH_ENABLE_ONEDNN_OPT"] = "0"

import numpy as np
import collections

TORCH_AVAILABLE = False
torch = None
try:
    import torch
    TORCH_AVAILABLE = True
except (ImportError, OSError) as e:
    print(f"[VAD] Notice: Torch library could not be loaded ({e}). Using Energy-based VAD fallback.")

_GLOBAL_SILERO_MODEL = None

class VADProcessor:
    def __init__(self, sample_rate: int = 16000):
        global _GLOBAL_SILERO_MODEL
        
        self.sample_rate = sample_rate

        # Silero VAD v4 expects exactly 512 samples per call at 16kHz.
        # 512 samples × 2 bytes per Int16 sample = 1024 bytes per frame.
        self.frame_bytes = 1024
        self.energy_sensitivity = 0.005
        
        # ── THE FIX: Model ko sirf tab load karo jab wo RAM mein na ho ──
        if TORCH_AVAILABLE and _GLOBAL_SILERO_MODEL is None and torch is not None:
            try:
                os.environ["USE_NNPACK"] = "0" 
                print("[SILERO] Loading Neural Network VAD Engine into Memory (ONCE)...")
                _GLOBAL_SILERO_MODEL, _ = torch.hub.load(
                    repo_or_dir='snakers4/silero-vad',
                    model='silero_vad',
                    force_reload=False,
                    trust_repo=True,
                )
                _GLOBAL_SILERO_MODEL.eval()
                print("[SILERO] AI Engine active and ready.")
            except Exception as e:
                print(f"[SILERO] Model load failed: {e}. Using Energy VAD fallback.")
                _GLOBAL_SILERO_MODEL = None
            
        # Global loaded model ko is naye connection ko de do
        self.model = _GLOBAL_SILERO_MODEL

        # Rolling activity buffer — tracks whether recent frames contained speech
        self.speech_buffer = collections.deque(maxlen=30)

        # Internal flag set after each process_frame() call.
        # True when speech_prob is in the 0.35–0.60 "confused" zone on active audio.
        # Routes.py reads this to pass silero_confused=True to DiarizationDetector.
        self._last_silero_confused: bool = False
        
    @property
    def silero_confusion_zone(self) -> bool:
        """
        True if the most recently processed frame had a Silero speech probability
        in the 0.35–0.60 range while also having active energy (energy > 0.008).

        This zone indicates Silero is uncertain — most commonly because it is
        hearing a mixture of two voices simultaneously. Routes.py should pass
        this flag to DiarizationDetector.detect_multiple_speakers() as
        silero_confused=True so the detector can weight this evidence correctly.
        """
        return self._last_silero_confused

    # ──────────────────────────────────────────────────────────────

    def process_frame(self, frame: bytes) -> tuple:
        """
        Process one 1024-byte (512-sample) Int16 PCM frame at 16kHz.

        Returns:
            (is_speech, energy, zcr, speech_prob) — all plain Python floats/bool.

            is_speech   – True when speech_prob > 0.5
            energy      – RMS amplitude of this frame (0.0 … ~0.3 for normal speech)
            zcr         – Zero-crossing rate (0.0 … 0.5)
            speech_prob – Silero output, clamped to [0.0, 1.0]

        Side effect:
            Sets self._last_silero_confused (readable via self.silero_confusion_zone).
        """
        # Reset confusion flag at the top of every call
        self._last_silero_confused = False

        if len(frame) < self.frame_bytes:
            return False, 0.0, 0.0, 0.0

        # Convert Int16 PCM bytes → normalized Float32 array in [-1.0, +1.0]
        audio_np = np.frombuffer(frame, dtype=np.int16).astype(np.float32) / 32768.0

        # ── Energy (RMS) ───────────────────────────────────────────────────
        # Cast explicitly to Python float to avoid numpy scalar type leakage.
        energy: float = float(np.sqrt(np.mean(audio_np ** 2))) if len(audio_np) > 0 else 0.0

        # ── Zero-Crossing Rate ─────────────────────────────────────────────
        # Number of times the signal crosses zero per sample (0.0 … 0.5).
        # Voiced speech: low ZCR (~0.04–0.15). Noise/unvoiced: high ZCR (> 0.20).
        zcr: float = (
            float(np.mean(np.abs(np.diff(np.sign(audio_np)))) / 2)
            if len(audio_np) > 1
            else 0.0
        )

        # ── Silero Neural VAD / Energy Fallback ────────────────────────────
        if self.model is not None and torch is not None:
            try:
                audio_tensor = torch.from_numpy(audio_np)
                with torch.no_grad():
                    raw_prob = self.model(audio_tensor, self.sample_rate).item()
            except Exception:
                raw_prob = 0.0
        else:
            # High-accuracy energy + zero-crossing rate fallback
            raw_prob = 0.85 if (energy > 0.012 and zcr < 0.25) else 0.05

        # Clamp to valid probability range — Silero can return slightly OOB values
        speech_prob: float = float(max(0.0, min(1.0, raw_prob)))

        # ── Confusion zone detection ───────────────────────────────────────
        # Silero returns 0.35–0.60 when hearing a mixed / uncertain signal.
        # This is most commonly caused by two simultaneous voices.
        # Only flag as confused when audio is actually active (not near-silence).
        if 0.35 <= speech_prob <= 0.60 and energy > 0.015:
            self._last_silero_confused = True

        is_speech: bool = speech_prob > 0.5
        return is_speech, energy, zcr, speech_prob