import type { RoiSample } from "../roi/types";
import type { PipelineResult } from "../worker/messages";
import type { SignalConfig } from "../config/signalConfig";

export interface SessionRecording {
  startedAt: string;
  userAgent: string;
  config: SignalConfig;
  /** Raw per-frame ROI samples, exactly as ingested by the worker. */
  samples: RoiSample[];
  /** Every worker tick's full result (once per second). */
  results: PipelineResult[];
}

/**
 * Records the raw signal-processing input/output for a debug session so it
 * can be exported and replayed offline against the exact same pipeline
 * code — far more precise than hand-written synthetic test signals when
 * debugging a specific real-world failure.
 */
export class SessionRecorder {
  private startedAt = new Date().toISOString();
  private samples: RoiSample[] = [];
  private results: PipelineResult[] = [];
  private config: SignalConfig;

  constructor(config: SignalConfig) {
    this.config = config;
  }

  recordSample(sample: RoiSample): void {
    this.samples.push(sample);
  }

  recordResult(result: PipelineResult): void {
    this.results.push(result);
  }

  sampleCount(): number {
    return this.samples.length;
  }

  resultCount(): number {
    return this.results.length;
  }

  toJSON(): SessionRecording {
    return {
      startedAt: this.startedAt,
      userAgent: navigator.userAgent,
      config: this.config,
      samples: this.samples,
      results: this.results,
    };
  }

  downloadAsFile(): void {
    const json = JSON.stringify(this.toJSON());
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = this.startedAt.replace(/[:.]/g, "-");
    a.href = url;
    a.download = `panicguard-session-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
