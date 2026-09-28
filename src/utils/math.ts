export function mean(xs: number[] | Float32Array): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < xs.length; i++) sum += xs[i];
  return sum / xs.length;
}

export function std(xs: number[] | Float32Array): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  let sumSq = 0;
  for (let i = 0; i < xs.length; i++) {
    const d = xs[i] - m;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / xs.length);
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Interquartile range using the linear-interpolation (R type 7) method. */
export function iqr(xs: number[]): number {
  if (xs.length < 2) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  return q3 - q1;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  return w;
}

/** Simple moving-average detrend: subtract the trailing windowSize moving average from each sample. */
export function movingAverageDetrend(xs: Float32Array, windowSize: number): Float32Array {
  const out = new Float32Array(xs.length);
  let sum = 0;
  const half = Math.floor(windowSize / 2);
  for (let i = 0; i < xs.length; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(xs.length - 1, i + half);
    sum = 0;
    for (let j = start; j <= end; j++) sum += xs[j];
    const avg = sum / (end - start + 1);
    out[i] = xs[i] - avg;
  }
  return out;
}

/**
 * Parabolic interpolation around a spectral peak at bin index `k` to refine
 * the peak location to sub-bin precision. `mags` is the magnitude spectrum.
 */
export function parabolicPeakOffset(mags: Float32Array, k: number): number {
  if (k <= 0 || k >= mags.length - 1) return 0;
  const yl = mags[k - 1];
  const y0 = mags[k];
  const yr = mags[k + 1];
  const denom = yl - 2 * y0 + yr;
  if (denom === 0) return 0;
  return (0.5 * (yl - yr)) / denom;
}
