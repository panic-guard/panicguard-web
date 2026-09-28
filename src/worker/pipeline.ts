import type { RoiColor, RoiName, RoiSample } from "../roi/types";
import type { SignalConfig } from "../config/signalConfig";
import { movingAverageDetrend } from "../utils/math";
import { resampleUniform, type TimeValue } from "./resampler";
import { posAlgorithm } from "./pos";
import { butterworthBandpassFiltFilt } from "./filters";
import { combineRoiSignals } from "./roiCombine";
import { computeSnrDb, computeSqi } from "./sqi";
import { HrEstimator } from "./hrEstimate";
import type { PipelineResult } from "./messages";

const ROI_NAMES: RoiName[] = ["forehead", "leftCheek", "rightCheek"];

function roiColorOf(s: RoiSample, name: RoiName): RoiColor {
  switch (name) {
    case "forehead":
      return s.forehead;
    case "leftCheek":
      return s.leftCheek;
    case "rightCheek":
      return s.rightCheek;
  }
}

/** Frame-to-frame landmark displacement / inter-ocular distance — same metric SQI's motion check uses. */
function motionRatioBetween(prev: RoiSample, cur: RoiSample): number | null {
  if (!prev.faceDetected || !cur.faceDetected || cur.interocularPx <= 0) return null;
  if (prev.motionLandmarks.length !== cur.motionLandmarks.length || cur.motionLandmarks.length === 0) return null;
  let sumDisp = 0;
  let count = 0;
  for (let k = 0; k < cur.motionLandmarks.length; k += 2) {
    const dx = cur.motionLandmarks[k] - prev.motionLandmarks[k];
    const dy = cur.motionLandmarks[k + 1] - prev.motionLandmarks[k + 1];
    sumDisp += Math.hypot(dx, dy);
    count++;
  }
  return count > 0 ? sumDisp / count / cur.interocularPx : null;
}

/**
 * Drops samples whose frame-to-frame motion exceeds the SQI motion
 * threshold before they ever reach POS, rather than only flagging them
 * after the fact via SQI. A fast head movement smears the ROI's true color
 * (partly motion blur, partly briefly sampling the wrong skin patch) —
 * feeding that sample into POS pollutes the signal even though the SQI
 * gate correctly refuses to trust the resulting HR. Dropping it here and
 * letting the resampler linearly bridge the gap from surrounding good
 * frames keeps brief motion from corrupting the color-channel input at
 * all; it does NOT rescue a genuinely motion-dominated stretch (e.g.
 * exercise) — SQI still (correctly) fails those, since most of the window
 * would need bridging.
 */
function excludeMotionSpikes(samples: RoiSample[], motionRatioMax: number): RoiSample[] {
  if (samples.length === 0) return samples;
  const kept: RoiSample[] = [samples[0]];
  for (let i = 1; i < samples.length; i++) {
    // Same consecutive-raw-pair comparison SQI's own motion check uses,
    // so "excluded here" and "counted against SQI's motionPassFrac" agree.
    const ratio = motionRatioBetween(samples[i - 1], samples[i]);
    if (ratio !== null && ratio > motionRatioMax) continue;
    kept.push(samples[i]);
  }
  return kept;
}

/**
 * Orchestrates the full rPPG pipeline: ingests RoiSamples as they arrive,
 * and on tick() recomputes resample -> POS -> filter -> combine -> SQI -> HR
 * over the trailing window. Recomputing from the raw buffer each tick
 * (instead of maintaining incremental streaming state for POS/filtering) is
 * a deliberate simplification: at ~300 samples/window it's computationally
 * cheap, mathematically equivalent to incremental overlap-add for the
 * required ~1s update cadence, and far less error-prone. HR estimation state
 * (previous BPM, outlier confirmation, stability history) genuinely needs
 * memory across ticks and is NOT recomputed from scratch.
 */
export class SignalPipeline {
  private config: SignalConfig;
  private raw: RoiSample[] = [];
  private segmentId = 0;
  private segmentStartT: number | null = null;
  private lastT: number | null = null;
  private lastBgLuma: number | null = null;
  private lastFaceLuma: number | null = null;
  private validSecondsAccum = 0;
  private lastValidSecondMark: number | null = null;
  private hrEstimator: HrEstimator;

  constructor(config: SignalConfig) {
    this.config = config;
    this.hrEstimator = new HrEstimator(config);
  }

  setConfig(config: SignalConfig): void {
    this.config = config;
    this.hrEstimator.setConfig(config);
  }

  reset(): void {
    this.raw = [];
    this.segmentId++;
    this.segmentStartT = null;
    this.lastT = null;
    this.lastBgLuma = null;
    this.lastFaceLuma = null;
    this.validSecondsAccum = 0;
    this.lastValidSecondMark = null;
    this.hrEstimator.reset();
  }

  ingest(samples: RoiSample[]): void {
    for (const s of samples) this.ingestOne(s);
  }

  private ingestOne(s: RoiSample): void {
    const bgLuma = (s.bg.r + s.bg.g + s.bg.b) / 3;
    const faceLuma = s.faceDetected
      ? (s.forehead.r + s.forehead.g + s.forehead.b) / 3
      : null;

    let discontinuity = false;
    if (this.lastT !== null) {
      const dt = s.t - this.lastT;
      if (dt > this.config.discontinuity.gapMs || dt < 0) {
        discontinuity = true;
      } else if (
        this.lastBgLuma !== null &&
        this.lastFaceLuma !== null &&
        faceLuma !== null
      ) {
        const bgJumpPct =
          this.lastBgLuma === 0 ? 0 : (Math.abs(bgLuma - this.lastBgLuma) / this.lastBgLuma) * 100;
        const faceJumpPct =
          this.lastFaceLuma === 0 ? 0 : (Math.abs(faceLuma - this.lastFaceLuma) / this.lastFaceLuma) * 100;
        if (
          bgJumpPct > this.config.discontinuity.brightnessJumpPct &&
          faceJumpPct > this.config.discontinuity.brightnessJumpPct
        ) {
          discontinuity = true;
        }
      }
    }

    if (discontinuity) {
      this.segmentId++;
      this.raw = [];
      this.segmentStartT = s.t;
      // hrEstimator is deliberately NOT reset here. validSecondsAccum is a
      // cumulative counter across the whole measurement attempt by design
      // (spec: valid_seconds is meant to survive exactly this kind of
      // transient blip) — wiping the stability history (just a list of past
      // committed bpm values, not raw signal state) on every discontinuity
      // was inconsistent with that and meant hr.stable could never
      // accumulate its 10 commits in a session with frequent
      // exposure/lighting jumps, no matter how long it ran. The POS/filter
      // state in `raw` still gets cleared above, since a real discontinuity
      // does corrupt any windowed computation spanning it.
    }
    if (this.segmentStartT === null) this.segmentStartT = s.t;

    this.raw.push(s);
    this.lastT = s.t;
    this.lastBgLuma = bgLuma;
    if (faceLuma !== null) this.lastFaceLuma = faceLuma;

    const maxEnsembleSec = Math.max(...this.config.hr.ensembleWindowSecs);
    const retainMs = (maxEnsembleSec + this.config.sqi.windowSec) * 1000 + 2000;
    const cutoff = s.t - retainMs;
    while (this.raw.length > 0 && this.raw[0].t < cutoff) this.raw.shift();
  }

  tick(): PipelineResult | null {
    if (this.raw.length < 4) return null;
    const now = this.raw[this.raw.length - 1].t;
    // Buffer window covers the longest ensemble scale; HrEstimator slices
    // its own shorter/right-aligned sub-windows out of the combined signal
    // this produces.
    const windowMs = Math.max(...this.config.hr.ensembleWindowSecs) * 1000;
    const windowStart = Math.max(this.segmentStartT ?? now - windowMs, now - windowMs);

    const windowRaw = this.raw.filter((s) => s.t >= windowStart);
    if (windowRaw.length < 4) return null;

    const hz = this.config.pos.sampleRateHz;
    const posInput = excludeMotionSpikes(windowRaw, this.config.sqi.thresholds.motionRatioMax);
    const roiFiltered: { bvp: Float32Array; snrDb: number }[] = [];

    for (const name of ROI_NAMES) {
      const rTv: TimeValue[] = posInput.map((s) => ({ t: s.t, v: roiColorOf(s, name).r }));
      const gTv: TimeValue[] = posInput.map((s) => ({ t: s.t, v: roiColorOf(s, name).g }));
      const bTv: TimeValue[] = posInput.map((s) => ({ t: s.t, v: roiColorOf(s, name).b }));

      const r = resampleUniform(rTv, windowStart, now, hz);
      const g = resampleUniform(gTv, windowStart, now, hz);
      const b = resampleUniform(bTv, windowStart, now, hz);

      const rawPos = posAlgorithm(r, g, b, this.config.pos.windowSamples);
      const detrended = movingAverageDetrend(
        rawPos,
        Math.max(1, Math.round(this.config.filter.detrendWindowSec * hz)),
      );
      const filtered = butterworthBandpassFiltFilt(detrended, hz, this.config.filter);
      const { snrDb } = computeSnrDb(
        filtered,
        hz,
        this.config.hr.fftSize,
        this.config.filter.bandpassLowHz,
        this.config.filter.bandpassHighHz,
      );
      roiFiltered.push({ bvp: filtered, snrDb });
    }

    const combined = combineRoiSignals(roiFiltered);

    // SQI's snr_db is spec'd as a 10s-window quantity; slice the trailing
    // sqi.windowSec of the (now longer, HR-ensemble-sized) combined buffer
    // rather than computing it over the whole thing.
    const sqiSnrSamples = Math.round(this.config.sqi.windowSec * hz);
    const combinedForSqi =
      combined.length >= sqiSnrSamples
        ? combined.subarray(combined.length - sqiSnrSamples)
        : combined;
    const combinedSnr = computeSnrDb(
      combinedForSqi,
      hz,
      this.config.hr.fftSize,
      this.config.filter.bandpassLowHz,
      this.config.filter.bandpassHighHz,
    );

    const sqiWindowStart = now - this.config.sqi.windowSec * 1000;
    const sqiRaw = this.raw.filter((s) => s.t >= sqiWindowStart);
    const motionRatios: number[] = [];
    for (let i = 1; i < sqiRaw.length; i++) {
      const ratio = motionRatioBetween(sqiRaw[i - 1], sqiRaw[i]);
      if (ratio !== null) motionRatios.push(ratio);
    }

    // Does the head's own pitch oscillation have a dominant frequency that
    // coincides with the candidate HR (directly, or via a harmonic)? A real
    // cardiac BVP signal and a breathing-synchronized head bob are
    // physically unrelated, so a coincidence here is much more likely a
    // shared motion artifact than genuine agreement — see computeSqi.
    const pitchTv: TimeValue[] = sqiRaw.map((s) => ({ t: s.t, v: s.pose.pitchDeg }));
    const pitchResampled = resampleUniform(pitchTv, sqiWindowStart, now, hz);
    const pitchDetrended = movingAverageDetrend(
      pitchResampled,
      Math.max(1, Math.round(this.config.filter.detrendWindowSec * hz)),
    );
    const poseFreq = computeSnrDb(
      pitchDetrended,
      hz,
      this.config.hr.fftSize,
      this.config.filter.bandpassLowHz,
      this.config.filter.bandpassHighHz,
    );
    // Separate, undetrended low-band search for breathing rate itself (as
    // slow as 0.15Hz): confirmed the standard ~1s moving-average detrend
    // used above suppresses a real 0.24Hz breathing peak by >7x (286 -> 38
    // in a real recorded session), which would make this search far less
    // sensitive than it needs to be. computeSnrDb's own band restriction
    // already excludes true DC without needing that detrend.
    const poseLowFreq = computeSnrDb(
      pitchResampled,
      hz,
      this.config.hr.fftSize,
      this.config.sqi.thresholds.poseLowBandLowHz,
      this.config.sqi.thresholds.poseLowBandHighHz,
    );

    const sqi = computeSqi(this.config, combinedSnr.snrDb, {
      motionRatios,
      yawDegs: sqiRaw.map((s) => s.pose.yawDeg),
      pitchDegs: sqiRaw.map((s) => s.pose.pitchDeg),
      satPcts: sqiRaw.map((s) =>
        Math.max(s.forehead.satPct, s.leftCheek.satPct, s.rightCheek.satPct),
      ),
      faceDetectedFlags: sqiRaw.map((s) => s.faceDetected),
      candidateFreqHz: combinedSnr.f0Hz,
      poseFreqHz: poseFreq.f0Hz,
      poseSnrDb: poseFreq.snrDb,
      poseLowFreqHz: poseLowFreq.f0Hz,
      poseLowSnrDb: poseLowFreq.snrDb,
    });

    const secondMark = Math.floor(now / 1000);
    if (sqi.allPass && secondMark !== this.lastValidSecondMark) {
      this.validSecondsAccum += 1;
    }
    this.lastValidSecondMark = secondMark;

    const hrResult = this.hrEstimator.update(combined, hz, sqi.allPass);

    const tailLen = Math.round(5 * hz);
    const tail = combined.slice(Math.max(0, combined.length - tailLen));

    return {
      t: now,
      segmentId: this.segmentId,
      bvpTail: Array.from(tail),
      spectrum: { freqs: Array.from(hrResult.freqs), mags: Array.from(hrResult.mags) },
      sqi,
      validSeconds: this.validSecondsAccum,
      hr: {
        bpm: hrResult.bpm,
        stable: hrResult.stable,
        acfFreqHz: hrResult.acfFreqHz,
        acfConfidence: hrResult.acfConfidence,
        ensembleSpreadBpm: hrResult.ensembleSpreadBpm,
        ensembleCount: hrResult.ensembleCount,
      },
      diagnostics: {
        poseFreqHz: poseFreq.f0Hz,
        poseSnrDb: poseFreq.snrDb,
        poseLowFreqHz: poseLowFreq.f0Hz,
        poseLowSnrDb: poseLowFreq.snrDb,
      },
    };
  }
}
