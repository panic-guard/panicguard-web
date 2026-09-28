import type { RoiSample } from "../roi/types";
import type { SignalConfig } from "../config/signalConfig";

export type ToWorker =
  | { type: "config"; config: SignalConfig }
  | { type: "samples"; samples: RoiSample[] }
  | { type: "reset" };

export interface PipelineResult {
  t: number;
  segmentId: number;
  bvpTail: number[];
  spectrum: { freqs: number[]; mags: number[] };
  sqi: {
    snrDb: number;
    motionPassFrac: number;
    yawDeg: number;
    pitchDeg: number;
    satPct: number;
    coveragePct: number;
    poseArtifactSuspected: boolean;
    allPass: boolean;
  };
  validSeconds: number;
  hr: {
    bpm: number | null;
    stable: boolean;
    acfFreqHz: number | null;
    acfConfidence: number | null;
    ensembleSpreadBpm: number | null;
    ensembleCount: number;
  };
  diagnostics: {
    /** Dominant in-band frequency of the head's own pitch oscillation — see pipeline.ts for why this is checked. */
    poseFreqHz: number;
    poseSnrDb: number;
    /** Dominant below-cardiac-band frequency (breathing rate range) — see pipeline.ts. */
    poseLowFreqHz: number;
    poseLowSnrDb: number;
  };
}

export type FromWorker =
  | { type: "ready" }
  | { type: "result"; payload: PipelineResult };
