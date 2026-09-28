import Fili from "fili";
import type { SignalConfig } from "../config/signalConfig";

/**
 * Zero-phase (forward-backward) Butterworth bandpass, built as a cascaded
 * highpass + lowpass rather than `fili`'s own `bandpass()` design.
 *
 * Measured empirically: `CalcCascades.bandpass({order:3, Fc:2.1, BW:2.8})`
 * (the direct approach) produces a severely skewed passband for this wide
 * a relative bandwidth (0.7-3.5Hz is a 5:1 ratio) — only ~8% amplitude
 * passthrough at 0.7Hz and ~40% at 1.1Hz (66 bpm), while ~2Hz (120 bpm)
 * passes at ~100%. That means, for anyone at a normal resting heart rate,
 * this filter alone suppresses the true fundamental well below its own 2nd
 * harmonic — a filter-shape bug, not a spectral-analysis problem, and the
 * actual root cause of HR readings locking onto ~2x the true value.
 *
 * A highpass(0.7Hz) + lowpass(3.5Hz) cascade, both order 3 Butterworth,
 * measured flat (0.99-1.00 amplitude) across ~1-2.5Hz with the expected
 * rolloff at the edges — use that instead.
 */
export function butterworthBandpassFiltFilt(
  signal: Float32Array,
  sampleRateHz: number,
  filterConfig: SignalConfig["filter"],
): Float32Array {
  if (signal.length === 0) return signal;

  const calc = new Fili.CalcCascades();
  const highpassStages = calc.highpass({
    order: filterConfig.order,
    characteristic: "butterworth",
    Fs: sampleRateHz,
    Fc: filterConfig.bandpassLowHz,
  });
  const lowpassStages = calc.lowpass({
    order: filterConfig.order,
    characteristic: "butterworth",
    Fs: sampleRateHz,
    Fc: filterConfig.bandpassHighHz,
  });

  const filter = new Fili.IirFilter([...highpassStages, ...lowpassStages]);
  const result = filter.filtfilt(Array.from(signal));

  return Float32Array.from(result);
}
