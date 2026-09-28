import { parabolicPeakOffset } from "./math";

export interface AcfPeriodResult {
  freqHz: number;
  /** Normalized autocorrelation value at the chosen lag (roughly 0..1 for a periodic signal). */
  confidence: number;
}

/**
 * Estimates the fundamental frequency of a (roughly zero-mean) signal via
 * normalized autocorrelation, searching lags corresponding to
 * [bandLowHz, bandHighHz]. Unlike an FFT magnitude peak, the autocorrelation
 * peak at the true period is generally strong even when a harmonic carries
 * more spectral *amplitude* than the fundamental — which is what makes it
 * useful for disambiguating FFT harmonic lock (see hrEstimate.ts).
 *
 * ACF has its own complementary failure mode, though: it peaks not just at
 * the true period but also at integer multiples of it (2x, 3x, ...), and
 * beat-to-beat amplitude modulation (e.g. respiration-driven variation) can
 * make a doubled-period lag correlate even more strongly than the true
 * period — which reads out as HALF the real heart rate. Mitigated with the
 * standard "shortest lag with comparably strong correlation" rule: scan
 * from short lags (high frequency) upward and take the first local peak
 * within `octavePreferenceRatio` of the global max, rather than blindly the
 * global max lag.
 */
export function estimateFundamentalFreqAcf(
  signal: Float32Array,
  sampleRateHz: number,
  bandLowHz: number,
  bandHighHz: number,
  octavePreferenceRatio = 0.75,
): AcfPeriodResult | null {
  const n = signal.length;
  const minLag = Math.max(1, Math.floor(sampleRateHz / bandHighHz));
  const maxLag = Math.min(n - 1, Math.ceil(sampleRateHz / bandLowHz));
  if (maxLag <= minLag) return null;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += signal[i];
  mean /= n;

  let energy0 = 0;
  for (let i = 0; i < n; i++) {
    const v = signal[i] - mean;
    energy0 += v * v;
  }
  if (energy0 <= 1e-12) return null;

  const len = maxLag - minLag + 1;
  const r = new Float32Array(len);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    for (let i = 0; i + lag < n; i++) {
      num += (signal[i] - mean) * (signal[i + lag] - mean);
    }
    r[lag - minLag] = num / energy0;
  }

  let globalMaxVal = -Infinity;
  for (let i = 0; i < len; i++) if (r[i] > globalMaxVal) globalMaxVal = r[i];
  if (globalMaxVal <= 0) return null;

  let chosenIdx = -1;
  for (let i = 0; i < len; i++) {
    const isLocalPeak = (i === 0 || r[i] >= r[i - 1]) && (i === len - 1 || r[i] >= r[i + 1]);
    if (isLocalPeak && r[i] >= octavePreferenceRatio * globalMaxVal) {
      chosenIdx = i;
      break;
    }
  }
  if (chosenIdx < 0) {
    for (let i = 0; i < len; i++) {
      if (r[i] === globalMaxVal) {
        chosenIdx = i;
        break;
      }
    }
  }
  if (chosenIdx < 0) return null;

  const offset = parabolicPeakOffset(r, chosenIdx);
  const refinedLag = minLag + chosenIdx + offset;
  if (refinedLag <= 0) return null;

  return { freqHz: sampleRateHz / refinedLag, confidence: r[chosenIdx] };
}
