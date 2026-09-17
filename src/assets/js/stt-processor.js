/**
 * AudioWorklet processor for Deepgram STT streaming.
 * Captures 16kHz mono audio and converts Float32 → Int16 PCM.
 * Posts Int16ArrayBuffer to port for WebSocket transmission.
 */
class STTProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      const float32 = input[0];
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      // Transfer the buffer (zero-copy) to avoid GC pressure
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }
    return true;
  }
}
registerProcessor('stt-processor', STTProcessor);