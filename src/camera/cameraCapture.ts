export interface CameraOptions {
  width: number;
  height: number;
  fps: number;
}

export type FrameCallback = (video: HTMLVideoElement, tMs: number) => void;

export class CameraCapture {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private frameCallback: FrameCallback | null = null;
  private rvfcHandle: number | null = null;
  private rafHandle: number | null = null;
  private running = false;
  private usingRvfc = false;
  private frameCount = 0;
  private lastFpsSampleT = 0;
  private fps = 0;

  constructor() {
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
  }

  async start(opts: CameraOptions): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: opts.width,
        height: opts.height,
        frameRate: { ideal: opts.fps },
      },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  stop(): void {
    this.pause();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  onFrame(cb: FrameCallback): void {
    this.frameCallback = cb;
  }

  getVideoTrack(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  resume(): void {
    if (this.running) return;
    this.running = true;
    if ("requestVideoFrameCallback" in this.video) {
      this.usingRvfc = true;
      this.scheduleRvfc();
    } else {
      this.usingRvfc = false;
      this.scheduleRaf();
    }
  }

  pause(): void {
    this.running = false;
    if (this.rvfcHandle !== null && "cancelVideoFrameCallback" in this.video) {
      this.video.cancelVideoFrameCallback(this.rvfcHandle);
      this.rvfcHandle = null;
    }
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  getFps(): number {
    return this.fps;
  }

  isUsingRvfc(): boolean {
    return this.usingRvfc;
  }

  private scheduleRvfc(): void {
    if (!this.running) return;
    this.rvfcHandle = this.video.requestVideoFrameCallback((_now, metadata) => {
      this.handleFrame(metadata.mediaTime * 1000);
      this.scheduleRvfc();
    });
  }

  private scheduleRaf(): void {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(() => {
      this.handleFrame(performance.now());
      this.scheduleRaf();
    });
  }

  private handleFrame(tMs: number): void {
    this.frameCount++;
    if (this.lastFpsSampleT === 0) this.lastFpsSampleT = tMs;
    const elapsed = tMs - this.lastFpsSampleT;
    if (elapsed >= 1000) {
      this.fps = (this.frameCount * 1000) / elapsed;
      this.frameCount = 0;
      this.lastFpsSampleT = tMs;
    }
    this.frameCallback?.(this.video, tMs);
  }
}
