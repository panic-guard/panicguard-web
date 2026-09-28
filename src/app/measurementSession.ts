import { CameraCapture } from "../camera/cameraCapture";
import { tryLockExposureAndWhiteBalance } from "../camera/exposureLock";
import { loadFaceLandmarker, detectForVideo } from "../face/faceLandmarker";
import { RoiExtractor } from "../roi/roiExtractor";
import { DEFAULT_SIGNAL_CONFIG } from "../config/signalConfig";
import { APP_CONFIG } from "./appConfig";
import type { ToWorker, FromWorker, PipelineResult } from "../worker/messages";
import type { RoiSample } from "../roi/types";

export interface MeasurementMetrics {
  hrBpm: number | null;
  hrStable: boolean;
  validSeconds: number;
  faceDetected: boolean;
  ready: boolean;
  forceFinished: boolean;
}

export type StartResult = { ok: true } | { ok: false; error: string };

/**
 * Background camera -> face tracking -> rPPG pipeline for the production
 * app flow. The face video is never shown (spec §2.3 — seeing one's own
 * distressed expression can heighten self-focused attention); it's kept in
 * the DOM off-screen only because some browsers require an attached,
 * playing <video> element for capture to keep running (notably iOS Safari).
 *
 * Unlike the ?debug=1 harness (mountDebugOverlay et al. in main.ts), this
 * exposes only the small set of aggregate signals the app screens need —
 * no waveform/spectrum panels, no session recording, no ROI overlay.
 */
export class MeasurementSession {
  private camera = new CameraCapture();
  private worker: Worker | null = null;
  private pending: RoiSample[] = [];
  private flushInterval: number | null = null;
  private latestResult: PipelineResult | null = null;
  private faceDetected = false;
  private startedAtMs: number | null = null;
  private listeners = new Set<(metrics: MeasurementMetrics) => void>();
  private cameraAvailable = false;

  async start(): Promise<StartResult> {
    // Anchors the 60s force-finish to when the user actually asked us to
    // start (matches their perceived wait), not to whenever face-landmarker
    // finishes loading (WASM + a ~3.7MB model from CDN — slow/variable
    // enough on a real network that anchoring there could silently add
    // 10s+ on top of the 60s budget with no visible explanation).
    this.startedAtMs = performance.now();

    this.camera.video.style.position = "fixed";
    this.camera.video.style.width = "1px";
    this.camera.video.style.height = "1px";
    this.camera.video.style.opacity = "0";
    this.camera.video.style.pointerEvents = "none";
    document.body.appendChild(this.camera.video);

    try {
      await this.camera.start(DEFAULT_SIGNAL_CONFIG.camera);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    this.cameraAvailable = true;

    const track = this.camera.getVideoTrack();
    if (track) void tryLockExposureAndWhiteBalance(track);

    const landmarker = await loadFaceLandmarker();
    const roiExtractor = new RoiExtractor(320);

    this.worker = new Worker(new URL("../worker/signalWorker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      if (event.data.type === "result") {
        this.latestResult = event.data.payload;
        this.notify();
      }
    };
    const configMsg: ToWorker = { type: "config", config: DEFAULT_SIGNAL_CONFIG };
    this.worker.postMessage(configMsg);

    this.flushInterval = window.setInterval(() => {
      if (this.pending.length === 0 || !this.worker) return;
      const msg: ToWorker = { type: "samples", samples: this.pending };
      this.worker.postMessage(msg);
      this.pending = [];
    }, 100);

    this.camera.onFrame((video, tMs) => {
      const detection = detectForVideo(landmarker, video, tMs);
      const sample = roiExtractor.extract(video, detection, tMs);
      this.pending.push(sample);
      this.faceDetected = sample.faceDetected;
      this.notify();
    });

    this.camera.resume();

    document.addEventListener("visibilitychange", this.handleVisibility);

    return { ok: true };
  }

  private handleVisibility = (): void => {
    if (document.hidden) this.camera.pause();
    else this.camera.resume();
  };

  isCameraAvailable(): boolean {
    return this.cameraAvailable;
  }

  onUpdate(cb: (metrics: MeasurementMetrics) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getMetrics(): MeasurementMetrics {
    const elapsedMs = this.startedAtMs !== null ? performance.now() - this.startedAtMs : 0;
    const forceFinished = elapsedMs >= APP_CONFIG.measure.forceFinishMs;
    const validSeconds = this.latestResult?.validSeconds ?? 0;
    const ready = validSeconds >= DEFAULT_SIGNAL_CONFIG.ready.minValidSeconds;
    return {
      hrBpm: this.latestResult?.hr.bpm ?? null,
      hrStable: this.latestResult?.hr.stable ?? false,
      validSeconds,
      faceDetected: this.faceDetected,
      ready,
      forceFinished,
    };
  }

  stop(): void {
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.camera.stop();
    this.camera.video.remove();
    if (this.flushInterval !== null) clearInterval(this.flushInterval);
    this.worker?.terminate();
    this.worker = null;
    this.listeners.clear();
  }

  private notify(): void {
    const metrics = this.getMetrics();
    for (const cb of this.listeners) cb(metrics);
  }
}
