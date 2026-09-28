import { magnitudeSpectrum } from "../utils/fft";
import { hannWindow, mean } from "../utils/math";
import type { SignalConfig } from "../config/signalConfig";

export interface SnrResult {
  snrDb: number;
  f0Hz: number;
  freqs: Float32Array;
  mags: Float32Array;
}

/**
 * Spectral SNR: power in (f0 +/- 0.1Hz) plus (2*f0 +/- 0.2Hz) vs. the rest of
 * the passband, in dB. f0 is the strongest peak within [bandLowHz, bandHighHz].
 */
export function computeSnrDb(
  signal: Float32Array,
  sampleRateHz: number,
  fftSize: number,
  bandLowHz: number,
  bandHighHz: number,
): SnrResult {
  if (signal.length < 8) {
    return { snrDb: -40, f0Hz: 0, freqs: new Float32Array(0), mags: new Float32Array(0) };
  }

  const window = hannWindow(signal.length);
  const { freqs, mags } = magnitudeSpectrum(signal, window, fftSize, sampleRateHz);

  let peakIdx = -1;
  let peakMag = -Infinity;
  for (let k = 0; k < freqs.length; k++) {
    if (freqs[k] < bandLowHz || freqs[k] > bandHighHz) continue;
    if (mags[k] > peakMag) {
      peakMag = mags[k];
      peakIdx = k;
    }
  }
  if (peakIdx < 0) return { snrDb: -40, f0Hz: 0, freqs, mags };
  const f0 = freqs[peakIdx];

  let signalPower = 0;
  let totalPower = 0;
  for (let k = 0; k < freqs.length; k++) {
    const f = freqs[k];
    if (f < bandLowHz || f > bandHighHz) continue;
    const p = mags[k] * mags[k];
    totalPower += p;
    if (Math.abs(f - f0) <= 0.1 || Math.abs(f - 2 * f0) <= 0.2) {
      signalPower += p;
    }
  }
  const noisePower = Math.max(totalPower - signalPower, 1e-9);
  const snrDb = 10 * Math.log10(Math.max(signalPower, 1e-9) / noisePower);
  return { snrDb, f0Hz: f0, freqs, mags };
}

export interface SqiWindowMeta {
  motionRatios: number[];
  yawDegs: number[];
  pitchDegs: number[];
  satPcts: number[];
  faceDetectedFlags: boolean[];
  /** BVP's own peak frequency (Hz) — compared against poseFreqHz to catch motion/breathing contamination. */
  candidateFreqHz: number;
  poseFreqHz: number;
  poseSnrDb: number;
  /** Pose signal's dominant frequency restricted to a below-cardiac-band search (breathing rate range) — see computeSqi. */
  poseLowFreqHz: number;
  poseLowSnrDb: number;
}

export interface SqiResult {
  snrDb: number;
  motionPassFrac: number;
  yawDeg: number;
  pitchDeg: number;
  satPct: number;
  coveragePct: number;
  /** True when the head's own periodic pitch motion has a clean peak coinciding with the candidate HR frequency — see pipeline.ts. */
  poseArtifactSuspected: boolean;
  allPass: boolean;
}

export function computeSqi(
  config: SignalConfig,
  combinedSnrDb: number,
  meta: SqiWindowMeta,
): SqiResult {
  const th = config.sqi.thresholds;
  const n = meta.faceDetectedFlags.length;

  const motionFails = meta.motionRatios.filter((r) => r > th.motionRatioMax).length;
  const motionDenominator = meta.motionRatios.length || 1;
  const motionPassFrac = motionFails / motionDenominator;

  const yawDeg = n === 0 ? 0 : mean(meta.yawDegs);
  const pitchDeg = n === 0 ? 0 : mean(meta.pitchDegs);
  const satPct = n === 0 ? 0 : mean(meta.satPcts);
  const coveragePct =
    n === 0 ? 0 : (meta.faceDetectedFlags.filter(Boolean).length / n) * 100;

  // A real cardiac BVP signal and the head's own pitch oscillation are
  // physically unrelated. If the pitch signal has a clean (high-SNR)
  // periodic component landing right on the candidate HR frequency, that's
  // much more likely a shared motion artifact (e.g. breathing-synchronized
  // head bob, small enough to pass the raw per-frame motion check yet
  // periodic enough to fool POS/FFT/ACF) than coincidence. Confirmed via
  // synthetic test: an asymmetric per-channel motion artifact can fool POS
  // the same way a real pulse does and would otherwise show up as a
  // confident, SQI-passing wrong reading without this check.
  const directMatch =
    meta.poseSnrDb > th.poseArtifactSnrDbMin &&
    Math.abs(meta.poseFreqHz - meta.candidateFreqHz) < th.poseArtifactMatchToleranceHz;

  // Breathing itself sits below the cardiac band (0.7Hz floor = 42bpm; normal
  // breathing is ~0.15-0.35Hz) so it can't trigger the direct check above —
  // but confirmed via a real recorded session: its 3rd/4th harmonic can land
  // squarely inside the cardiac band and get mistaken for HR, even though
  // the pose signal's own TRUE dominant frequency (found searching a wider
  // below-band range) is nowhere near the candidate. Check low-band
  // harmonics explicitly rather than just the 1:1 match.
  let harmonicMatch = false;
  if (meta.poseLowSnrDb > th.poseArtifactSnrDbMin && meta.poseLowFreqHz > 0) {
    for (let harmonic = 2; harmonic <= th.poseArtifactHarmonicsMax; harmonic++) {
      if (Math.abs(meta.poseLowFreqHz * harmonic - meta.candidateFreqHz) < th.poseArtifactMatchToleranceHz) {
        harmonicMatch = true;
        break;
      }
    }
  }

  const poseArtifactSuspected = directMatch || harmonicMatch;

  const passes = {
    snr: combinedSnrDb > th.snrDbMin,
    motion: motionPassFrac < th.motionFrameFailPctMax,
    pose: Math.abs(yawDeg) < th.yawMaxDeg && Math.abs(pitchDeg) < th.pitchMaxDeg,
    saturation: satPct < th.saturationPctMax,
    coverage: coveragePct >= th.coveragePctMin,
    poseArtifact: !poseArtifactSuspected,
  };

  const allPass =
    passes.snr && passes.motion && passes.pose && passes.saturation && passes.coverage && passes.poseArtifact;

  return { snrDb: combinedSnrDb, motionPassFrac, yawDeg, pitchDeg, satPct, coveragePct, poseArtifactSuspected, allPass };
}
