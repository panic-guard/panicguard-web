export interface TimeValue {
  t: number;
  v: number;
}

/**
 * Linearly resamples an irregularly-timed (t, v) series onto a uniform grid
 * at `hz`, from `startMs` to `endMs` inclusive. Values outside the raw
 * series' time range are clamped to the nearest endpoint.
 */
export function resampleUniform(
  raw: TimeValue[],
  startMs: number,
  endMs: number,
  hz: number,
): Float32Array {
  const stepMs = 1000 / hz;
  const n = Math.max(0, Math.floor((endMs - startMs) / stepMs) + 1);
  const out = new Float32Array(n);
  if (raw.length === 0 || n === 0) return out;

  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = startMs + i * stepMs;

    if (t <= raw[0].t) {
      out[i] = raw[0].v;
      continue;
    }
    if (t >= raw[raw.length - 1].t) {
      out[i] = raw[raw.length - 1].v;
      continue;
    }

    while (k < raw.length - 1 && raw[k + 1].t < t) k++;
    const a = raw[k];
    const b = raw[Math.min(k + 1, raw.length - 1)];
    if (b.t === a.t) {
      out[i] = a.v;
      continue;
    }
    const frac = (t - a.t) / (b.t - a.t);
    out[i] = a.v + frac * (b.v - a.v);
  }
  return out;
}
