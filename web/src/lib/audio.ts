/**
 * Streams raw PCM (16-bit signed little-endian) audio chunks through Web Audio
 * API by scheduling AudioBufferSourceNodes back-to-back.
 *
 * Web Audio resamples on the fly, so the PCM source rate (e.g. 24000Hz) does
 * not have to match the AudioContext output rate (typically 48000Hz).
 *
 * Every scheduled source is routed through a shared AnalyserNode
 * (source -> analyser -> destination) so the UI can read the currently-audible
 * amplitude and drive avatar lip-sync. See {@link getLevel}.
 */
export interface PcmFormat {
  sampleRateHertz: number;
  channels: number;
  bitsPerSample: number; // only 16 is supported here.
}

export class StreamingPcmPlayer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private timeData: Float32Array<ArrayBuffer> | null = null;
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
  /** Sources scheduled but not yet ended, so stop() can halt them mid-flight. */
  private activeSources = new Set<AudioBufferSourceNode>();
  /** After stop(), further appended audio is ignored until the next start(). */
  private stopped = false;

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
    // Some browsers start the context suspended until a user gesture; calling
    // resume() here is safe because send() is triggered from a click/keypress.
    void this.ctx.resume().catch(() => {});

    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    // We apply our own attack/decay smoothing on the RMS, so keep the raw
    // analyser unsmoothed for a responsive mouth.
    analyser.smoothingTimeConstant = 0;
    analyser.connect(this.ctx.destination);
    this.analyser = analyser;
    this.timeData = new Float32Array(analyser.fftSize);

    this.nextStartTime = this.ctx.currentTime;
    this.leftoverByte = null;
    this.stopped = false;
  }

  appendPcm(buffer: ArrayBuffer): void {
    const ctx = this.ctx;
    if (!ctx || this.stopped) return;

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
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
    source.connect(this.analyser ?? ctx.destination);
    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      source.disconnect();
    };

    const startAt = Math.max(ctx.currentTime, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + audioBuffer.duration;
  }

  /**
   * Instantaneous loudness of what is audible right now, as RMS of the analyser
   * time-domain window. ~0 when silent, rising toward ~0.3 for loud speech.
   * Callers smooth/scale this into a 0..1 mouth-open weight.
   */
  getLevel(): number {
    const analyser = this.analyser;
    const data = this.timeData;
    if (!analyser || !data) return 0;
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i] ?? 0;
      sum += v * v;
    }
    return Math.sqrt(sum / data.length);
  }

  /** True while audio is scheduled to keep playing past the current time. */
  isPlaying(): boolean {
    if (!this.ctx) return false;
    return this.nextStartTime > this.ctx.currentTime + 0.02;
  }

  /**
   * Stop playback immediately: halt every scheduled source and drop any audio
   * appended afterwards until the next start(). Used by the "stop voice" button.
   */
  stop(): void {
    this.stopped = true;
    for (const source of this.activeSources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // already stopped or ended — ignore
      }
      source.disconnect();
    }
    this.activeSources.clear();
    this.leftoverByte = null;
    if (this.ctx) this.nextStartTime = this.ctx.currentTime;
  }

  finish(): void {
    // PCM has no end-of-stream marker; sources finish naturally.
  }

  dispose(): void {
    for (const source of this.activeSources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // ignore
      }
      source.disconnect();
    }
    this.activeSources.clear();
    this.stopped = false;
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.analyser = null;
    this.timeData = null;
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
