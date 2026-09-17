from __future__ import annotations

import logging
import numpy as np

logger = logging.getLogger(__name__)


class NoiseFilter:
    """
    Streaming noise filter using noisereduce's stationary spectral gate.

    Usage in routes.py:

        noise_filter = NoiseFilter(sample_rate=16000)
        ...
        # In the frame loop, BEFORE VAD and BEFORE forwarding to Deepgram:
        cleaned_frame = noise_filter.process_frame(frame)
        is_speech, energy, zcr, speech_prob = vad_processor.process_frame(cleaned_frame)
        if dg_ws and not dg_ws.closed:
            await dg_ws.send_bytes(cleaned_frame)
    """

    # Number of 32-ms frames (512 samples @ 16 kHz) to buffer before
    # running noisereduce. 8 frames ≈ 256 ms — enough context for the
    # spectral gate to estimate a noise floor, small enough to keep
    # per-call latency under ~3 ms on commodity CPU.
    BUFFER_FRAMES = 8

    # Samples per Int16 frame (Silero VAD v4 expects exactly 512 @ 16 kHz).
    SAMPLES_PER_FRAME = 512

    # How aggressively to suppress identified noise (0.0 = none, 1.0 = full).
    # 0.85 removes most keyboard/fan/AC noise while preserving speech
    # intelligibility for both Silero and Deepgram.
    PROP_DECREASE = 0.85

    def __init__(self, sample_rate: int = 16000):
        self.sample_rate = sample_rate
        self._buffer: list[np.ndarray] = []
        self._enabled = False
        self._frames_seen = 0
        self._frames_filtered = 0
        self._try_init()

    def _try_init(self) -> None:
        """Try to import noisereduce; gracefully degrade if unavailable."""
        try:
            import noisereduce  # type: ignore
            self._noisereduce = noisereduce
            self._enabled = True
            logger.info(
                "[NoiseFilter] noisereduce %s loaded — spectral gating ACTIVE "
                "(prop_decrease=%.2f, buffer=%d frames ≈ %d ms)",
                getattr(noisereduce, "__version__", "?"),
                self.PROP_DECREASE,
                self.BUFFER_FRAMES,
                int(self.BUFFER_FRAMES * self.SAMPLES_PER_FRAME
                    / self.sample_rate * 1000),
            )
        except ImportError:
            self._noisereduce = None
            self._enabled = False
            logger.warning(
                "[NoiseFilter] noisereduce NOT installed — running in "
                "PASSTHROUGH mode. Install with: pip install noisereduce"
            )

    @property
    def enabled(self) -> bool:
        return self._enabled

    def process_frame(self, frame_int16: bytes) -> bytes:
        """
        Process one 1024-byte (512-sample) Int16 PCM frame at 16 kHz.

        Returns cleaned Int16 PCM of the same length, ready to feed into
        VADProcessor.process_frame() and/or forward to Deepgram.

        Behavior:
          • Passthrough if noisereduce isn't installed.
          • Passthrough during warm-up (first BUFFER_FRAMES calls) — we
            don't have enough context yet.
          • After warm-up: returns the cleaned version of the most recent
            input frame, using the rolling buffer for noise estimation.
        """
        self._frames_seen += 1

        # Passthrough when the library isn't available.
        if not self._enabled:
            return frame_int16

        # Decode Int16 → Float32 in [-1, 1]
        samples = np.frombuffer(frame_int16, dtype=np.int16).astype(np.float32) / 32768.0
        self._buffer.append(samples)

        # Warm-up: not enough context to filter yet. Pass through.
        if len(self._buffer) < self.BUFFER_FRAMES:
            return frame_int16

        # Slide the window: drop oldest frame to keep buffer size constant.
        if len(self._buffer) > self.BUFFER_FRAMES:
            self._buffer.pop(0)

        # Run noisereduce on the full buffer (stationary spectral gate).
        chunk = np.concatenate(self._buffer)
        try:
            cleaned_chunk = self._noisereduce.reduce_noise(
                y=chunk,
                sr=self.sample_rate,
                stationary=True,
                prop_decrease=self.PROP_DECREASE,
            )
        except Exception as e:
            # noisereduce can occasionally fail on near-silent input
            if self._frames_seen % 100 == 0:
                logger.warning(
                    "[NoiseFilter] noisereduce failed on frame %d: %s — "
                    "passthrough", self._frames_seen, e
                )
            return frame_int16

        # Extract only the cleaned version of the most recent frame.
        last_frame_float = cleaned_chunk[-self.SAMPLES_PER_FRAME:]

        # Convert back to Int16 PCM bytes (little-endian, like the input).
        last_frame_int16 = np.clip(
            last_frame_float * 32767.0, -32768, 32767
        ).astype(np.int16)

        self._frames_filtered += 1

        # Periodic health log
        if self._frames_seen % 1000 == 0:
            logger.info(
                "[NoiseFilter] Stats: seen=%d, filtered=%d, "
                "input_rms=%.4f, output_rms=%.4f, "
                "noise_removed_pct=%.1f%%",
                self._frames_seen,
                self._frames_filtered,
                float(np.sqrt(np.mean(samples ** 2))),
                float(np.sqrt(np.mean(last_frame_float ** 2))),
                (1.0 - float(np.sqrt(np.mean(last_frame_float ** 2))
                              / max(1e-9, float(np.sqrt(np.mean(samples ** 2)))))) * 100.0,
            )

        return last_frame_int16.tobytes()

    def reset(self) -> None:
        """Clear the rolling buffer (e.g. on a long silence gap)."""
        self._buffer = []

    def stats(self) -> dict:
        """Return runtime stats for monitoring/debugging."""
        return {
            "enabled": self._enabled,
            "frames_seen": self._frames_seen,
            "frames_filtered": self._frames_filtered,
            "buffer_size": len(self._buffer),
        }