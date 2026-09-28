export interface RoiSignal {
  bvp: Float32Array;
  snrDb: number;
}

/**
 * SNR-weighted average of per-ROI BVP signals. ROIs with snr_db <= 0 are
 * excluded from the combination (per spec); if every ROI is at/below 0dB,
 * falls back to combining all of them anyway so the debug view still shows
 * something during poor-quality stretches instead of going blank.
 */
export function combineRoiSignals(signals: RoiSignal[]): Float32Array {
  if (signals.length === 0) return new Float32Array(0);

  let usable = signals.filter((s) => s.snrDb > 0);
  if (usable.length === 0) usable = signals;

  const len = Math.min(...usable.map((s) => s.bvp.length));
  if (len === 0) return new Float32Array(0);

  const weights = usable.map((s) => Math.max(s.snrDb, 0) + 1e-6);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (let k = 0; k < usable.length; k++) {
      sum += usable[k].bvp[i] * weights[k];
    }
    out[i] = sum / totalWeight;
  }
  return out;
}
