import { std } from "../utils/math";

/**
 * POS (Plane-Orthogonal-to-Skin) rPPG algorithm, Wang et al. 2017 (IEEE TBME).
 * Slides a window of `windowSamples` (default 48 @ 30Hz = 1.6s) one sample at
 * a time over the R/G/B channels, and overlap-adds each window's pulse
 * estimate into the output signal.
 *
 * The overlap-add is normalized by each position's actual contribution
 * count (windowSamples in the interior, ramping down to 1 at the array
 * edges). Skipping that normalization — summing without dividing — leaves
 * the last windowSamples-1 samples (the most recent ~1.6s) at only a
 * fraction of the interior's amplitude, since they're covered by fewer
 * overlapping windows. That tail is exactly what every right-aligned
 * downstream analysis window always includes, so an unnormalized sum
 * quietly starves the freshest, most relevant data of SNR — confirmed by
 * measuring the RMS envelope of unnormalized output: ~0.13 steady-state vs.
 * ~0.045 in the last second, before this fix.
 */
export function posAlgorithm(
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  windowSamples: number,
): Float32Array {
  const n = r.length;
  const H = new Float32Array(n);
  const contributions = new Float32Array(n);
  if (n < windowSamples) return H;

  const s1 = new Float32Array(windowSamples);
  const s2 = new Float32Array(windowSamples);
  const h = new Float32Array(windowSamples);

  for (let start = 0; start <= n - windowSamples; start++) {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (let i = 0; i < windowSamples; i++) {
      sumR += r[start + i];
      sumG += g[start + i];
      sumB += b[start + i];
    }
    const meanR = sumR / windowSamples;
    const meanG = sumG / windowSamples;
    const meanB = sumB / windowSamples;
    if (meanR === 0 || meanG === 0 || meanB === 0) continue;

    for (let i = 0; i < windowSamples; i++) {
      const cr = r[start + i] / meanR;
      const cg = g[start + i] / meanG;
      const cb = b[start + i] / meanB;
      s1[i] = cg - cb;
      s2[i] = -2 * cr + cg + cb;
    }

    const std1 = std(s1);
    const std2 = std(s2);
    const alpha = std2 === 0 ? 0 : std1 / std2;

    let hSum = 0;
    for (let i = 0; i < windowSamples; i++) {
      const v = s1[i] + alpha * s2[i];
      h[i] = v;
      hSum += v;
    }
    const hMean = hSum / windowSamples;
    for (let i = 0; i < windowSamples; i++) {
      H[start + i] += h[i] - hMean;
      contributions[start + i] += 1;
    }
  }

  for (let i = 0; i < n; i++) {
    if (contributions[i] > 0) H[i] /= contributions[i];
  }

  return H;
}
