/**
 * Streams raw PCM (16-bit signed little-endian) audio chunks through Web Audio
 * API by scheduling AudioBufferSourceNodes back-to-back.
 *
 * Web Audio resamples on the fly, so the PCM source rate (e.g. 24000Hz) does
 * not have to match the AudioContext output rate (typically 48000Hz).
 */
export interface PcmFormat {
  sampleRateHertz: number;
  channels: number;
  bitsPerSample: number; // only 16 is supported here.
}

export class StreamingPcmPlayer {
  private ctx: AudioContext | null = null;
  private nextStartTime = 0;
  private format: PcmFormat = {
    sampleRateHertz: 24000,
    channels: 1,
    bitsPerSample: 16,
  };
  /**
   * If a chunk arrives with an odd number of bytes, the unused last byte is
   * held over for the next chunk so the int16 stride stays aligned.
   */
  private leftoverByte: number | null = null;

  static isSupported(): boolean {
    return (
      typeof AudioContext !== "undefined" ||
      typeof (window as unknown as { webkitAudioContext?: unknown })
        .webkitAudioContext !== "undefined"
    );
  }

  configure(format: PcmFormat): void {
    if (format.bitsPerSample !== 16) {
      console.warn(
        `StreamingPcmPlayer only supports 16-bit PCM, got ${format.bitsPerSample}`,
      );
    }
    this.format = format;
  }

  start(): void {
    this.dispose();
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctor();
    this.nextStartTime = this.ctx.currentTime;
    this.leftoverByte = null;
  }

  appendPcm(buffer: ArrayBuffer): void {
    const ctx = this.ctx;
    if (!ctx) return;

    let bytes: Uint8Array = new Uint8Array(buffer);

    if (this.leftoverByte !== null) {
      const combined = new Uint8Array(bytes.length + 1);
      combined[0] = this.leftoverByte;
      combined.set(bytes, 1);
      bytes = combined;
      this.leftoverByte = null;
    }

    if (bytes.length % 2 !== 0) {
      this.leftoverByte = bytes[bytes.length - 1] ?? null;
      bytes = bytes.subarray(0, bytes.length - 1);
    }
    if (bytes.length === 0) return;

    const sampleCount = bytes.length / 2;
    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    const float32 = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      float32[i] = view.getInt16(i * 2, true) / 32768;
    }

    const audioBuffer = ctx.createBuffer(
      this.format.channels,
      sampleCount,
      this.format.sampleRateHertz,
    );
    audioBuffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + audioBuffer.duration;
  }

  finish(): void {
    // PCM has no end-of-stream marker; sources finish naturally.
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.nextStartTime = 0;
    this.leftoverByte = null;
  }
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
