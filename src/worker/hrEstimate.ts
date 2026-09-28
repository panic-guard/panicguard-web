import { magnitudeSpectrum } from "../utils/fft";
import { hannWindow, iqr, median, parabolicPeakOffset } from "../utils/math";
import { estimateFundamentalFreqAcf } from "../utils/autocorrelation";
import type { SignalConfig } from "../config/signalConfig";

export interface WindowEstimate {
  bpm: number;
  acfFreqHz: number | null;
  acfConfidence: number | null;
  freqs: Float32Array;
  mags: Float32Array;
}

/**
 * Stateless single-window frequency estimate: FFT peak (Hann + zero-pad +
 * parabolic sub-bin refinement) cross-checked against an autocorrelation
 * estimate to resolve FFT harmonic lock. Returns null if the window is too
 * short or has no discernible peak in-band.
 */
export function estimateWindowFrequency(
  bvpWindow: Float32Array,
  sampleRateHz: number,
  config: SignalConfig,
  referenceBpm: number | null = null,
): WindowEstimate | null {
  const cfg = config.hr;
  const bandLow = config.filter.bandpassLowHz;
  const bandHigh = config.filter.bandpassHighHz;

  if (bvpWindow.length < 8) return null;

  const window = hannWindow(bvpWindow.length);
  const { freqs, mags } = magnitudeSpectrum(bvpWindow, window, cfg.fftSize, sampleRateHz);

  let peakIdx = -1;
  let peakMag = -Infinity;
  for (let k = 0; k < freqs.length; k++) {
    if (freqs[k] < bandLow || freqs[k] > bandHigh) continue;
    if (mags[k] > peakMag) {
      peakMag = mags[k];
      peakIdx = k;
    }
  }
  if (peakIdx < 0) return null;

  const binHz = sampleRateHz / cfg.fftSize;
  const offset = parabolicPeakOffset(mags, peakIdx);
  let f0 = freqs[peakIdx] + offset * binHz;

  // Near-tie tie-break: a window straddling a genuine fast HR transition
  // (e.g. sprinting to rest) can contain comparable spectral energy at BOTH
  // the old and new frequency, with which one edges out the argmax often
  // decided by only ~15% magnitude — confirmed in a real recorded session
  // where two unrelated (non-harmonic) peaks ~25bpm apart were within 15%
  // of each other's power and picking the wrong one was a coin flip. The
  // spectrum genuinely can't decide in that situation, so this ONLY applies
  // when there's a real near-tie (never overrides a clearly dominant peak),
  // and only nudges toward whichever candidate is closer to the last
  // committed reading — it can't manufacture a result the spectrum doesn't
  // already support.
  if (referenceBpm !== null) {
    let secondIdx = -1;
    let secondMag = -Infinity;
    for (let k = 1; k < freqs.length - 1; k++) {
      if (freqs[k] < bandLow || freqs[k] > bandHigh || k === peakIdx) continue;
      if (mags[k] > mags[k - 1] && mags[k] > mags[k + 1] && mags[k] > secondMag) {
        secondMag = mags[k];
        secondIdx = k;
      }
    }
    if (secondIdx >= 0 && secondMag ** 2 >= cfg.nearTiePowerRatio * peakMag ** 2) {
      const secondOffset = parabolicPeakOffset(mags, secondIdx);
      const secondF0 = freqs[secondIdx] + secondOffset * binHz;
      const refHz = referenceBpm / 60;
      if (Math.abs(secondF0 - refHz) < Math.abs(f0 - refHz)) {
        f0 = secondF0;
        peakMag = secondMag;
      }
    }
  }

  const acf = estimateFundamentalFreqAcf(
    bvpWindow,
    sampleRateHz,
    bandLow,
    bandHigh,
    cfg.acfOctavePreferenceRatio,
  );
  if (acf && acf.confidence > cfg.acfConfidenceMin) {
    // Only let ACF redirect the estimate toward a candidate the FFT
    // spectrum itself has real (if weaker) evidence for — never toward a
    // frequency with negligible spectral power just because ACF's *time*
    // domain estimate happens to land near it. ACF has its own failure mode
    // (period-doubling from beat-to-beat amplitude variation) that can be
    // confident yet wrong; requiring spectral corroboration bounds how much
    // damage a bad ACF read can do to an otherwise-clean FFT peak.
    const candidates = [f0];
    const halfF = f0 / 2;
    if (halfF >= bandLow) {
      const halfIdx = Math.round(halfF / binHz);
      if (halfIdx >= 0 && halfIdx < mags.length && mags[halfIdx] ** 2 >= cfg.harmonicPowerRatio * peakMag ** 2) {
        candidates.push(halfF);
      }
    }
    const doubleF = f0 * 2;
    if (doubleF <= bandHigh) {
      const doubleIdx = Math.round(doubleF / binHz);
      if (
        doubleIdx >= 0 &&
        doubleIdx < mags.length &&
        mags[doubleIdx] ** 2 >= cfg.harmonicPowerRatio * peakMag ** 2
      ) {
        candidates.push(doubleF);
      }
    }

    let best = f0;
    let bestDist = Infinity;
    for (const c of candidates) {
      const d = Math.abs(c - acf.freqHz);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (bestDist < cfg.acfMatchToleranceHz) f0 = best;
  }

  return {
    bpm: f0 * 60,
    acfFreqHz: acf?.freqHz ?? null,
    acfConfidence: acf?.confidence ?? null,
    freqs,
    mags,
  };
}

export interface HrUpdateResult {
  bpm: number | null;
  stable: boolean;
  freqs: Float32Array;
  mags: Float32Array;
  acfFreqHz: number | null;
  acfConfidence: number | null;
  /** Max-min spread (bpm) across this tick's multi-scale ensemble candidates. */
  ensembleSpreadBpm: number | null;
  ensembleCount: number;
}

/**
 * Multi-scale ensemble HR estimator. Each tick, `estimateWindowFrequency`
 * runs independently over several trailing window lengths (config
 * `hr.ensembleWindowSecs`, all right-aligned to "now"), and the MEDIAN bpm
 * across them is taken as the tick's estimate. This is the main defense
 * against single-tick spikes: a transient artifact (motion blip, brief
 * specular flash, momentary bad ROI) distorts a subset of the window
 * scales but is diluted or absent in the others, so the median rejects it
 * rather than reporting it directly.
 *
 * On top of that: an outlier-jump guard (only required when the ensemble
 * itself disagrees — see `ensembleTightSpreadBpm`) and an IQR-based
 * stability flag over committed estimates. Holds state across calls
 * (previous committed estimate, pending-outlier counter, recent-estimate
 * history) — one instance per measurement segment; call reset() on segment
 * change. `sqiPass` gates whether a tick's estimate is allowed to become
 * the new committed/history value.
 */
export class HrEstimator {
  private config: SignalConfig;
  private prevBpm: number | null = null;
  private pendingBpm: number | null = null;
  private pendingCount = 0;
  private validHistory: number[] = [];
  /**
   * Last tick's raw ensemble median, updated every tick regardless of
   * sqiPass — unlike prevBpm (only updated on SQI-passing ticks, used for
   * the stricter outlier-jump/stability logic). Used only as the near-tie
   * tie-break reference in estimateWindowFrequency: during an extended
   * stretch where SQI keeps failing (exactly when this tie-break matters
   * most — e.g. a noisy post-exercise window), prevBpm would otherwise
   * stay stuck on a stale value from well before the stretch even started.
   */
  private lastRawMedianBpm: number | null = null;

  constructor(config: SignalConfig) {
    this.config = config;
  }

  setConfig(config: SignalConfig): void {
    this.config = config;
  }

  reset(): void {
    this.prevBpm = null;
    this.pendingBpm = null;
    this.pendingCount = 0;
    this.validHistory = [];
    this.lastRawMedianBpm = null;
  }

  update(combinedBvpBuffer: Float32Array, sampleRateHz: number, sqiPass: boolean): HrUpdateResult {
    const cfg = this.config.hr;

    const candidates: WindowEstimate[] = [];
    for (const sec of cfg.ensembleWindowSecs) {
      const winLen = Math.round(sec * sampleRateHz);
      if (combinedBvpBuffer.length < winLen) continue;
      const sub = combinedBvpBuffer.subarray(combinedBvpBuffer.length - winLen);
      const est = estimateWindowFrequency(sub, sampleRateHz, this.config, this.lastRawMedianBpm);
      if (est) candidates.push(est);
    }

    if (candidates.length === 0) {
      return {
        bpm: this.prevBpm,
        stable: this.isStable(),
        freqs: new Float32Array(0),
        mags: new Float32Array(0),
        acfFreqHz: null,
        acfConfidence: null,
        ensembleSpreadBpm: null,
        ensembleCount: 0,
      };
    }

    const sortedBpms = candidates.map((c) => c.bpm).sort((a, b) => a - b);
    const medianBpm = median(sortedBpms);
    const spreadBpm = sortedBpms[sortedBpms.length - 1] - sortedBpms[0];
    this.lastRawMedianBpm = medianBpm;

    let rep = candidates[0];
    let repDist = Infinity;
    for (const c of candidates) {
      const d = Math.abs(c.bpm - medianBpm);
      if (d < repDist) {
        repDist = d;
        rep = c;
      }
    }

    const debugFields = {
      freqs: rep.freqs,
      mags: rep.mags,
      acfFreqHz: rep.acfFreqHz,
      acfConfidence: rep.acfConfidence,
      ensembleSpreadBpm: spreadBpm,
      ensembleCount: candidates.length,
    };

    if (!sqiPass) {
      return { bpm: medianBpm, stable: this.isStable(), ...debugFields };
    }

    const ensembleAgrees = spreadBpm <= cfg.ensembleTightSpreadBpm;

    if (this.prevBpm !== null && Math.abs(medianBpm - this.prevBpm) >= cfg.outlierJumpBpm && !ensembleAgrees) {
      if (this.pendingBpm !== null && Math.abs(medianBpm - this.pendingBpm) < 3) {
        this.pendingCount++;
      } else {
        this.pendingBpm = medianBpm;
        this.pendingCount = 1;
      }
      if (this.pendingCount < cfg.outlierConfirmSec) {
        return { bpm: this.prevBpm, stable: this.isStable(), ...debugFields };
      }
      this.pendingBpm = null;
      this.pendingCount = 0;
    } else {
      this.pendingBpm = null;
      this.pendingCount = 0;
    }

    this.prevBpm = medianBpm;
    this.validHistory.push(medianBpm);
    if (this.validHistory.length > cfg.stabilityWindowCount) this.validHistory.shift();

    return { bpm: medianBpm, stable: this.isStable(), ...debugFields };
  }

  private isStable(): boolean {
    if (this.validHistory.length < this.config.hr.stabilityWindowCount) return false;
    return iqr(this.validHistory) < this.config.hr.stabilityIqrBpm;
  }
}
