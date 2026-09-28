/**
 * In-place iterative radix-2 Cooley-Tukey FFT. `re`/`im` must have a
 * power-of-two length. Real-valued input: pass zeros for `im`.
 */
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n !== im.length) throw new Error("fft: re/im length mismatch");
  if (n === 0 || (n & (n - 1)) !== 0) {
    throw new Error("fft: length must be a power of two");
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const vIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe;
        im[i + k + half] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }
}

/**
 * Windowed, zero-padded magnitude spectrum of a real signal.
 * Returns magnitudes for bins [0, fftSize/2] and their frequencies (Hz).
 */
export function magnitudeSpectrum(
  signal: Float32Array,
  window: Float32Array,
  fftSize: number,
  sampleRateHz: number,
): { freqs: Float32Array; mags: Float32Array } {
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const n = Math.min(signal.length, window.length, fftSize);
  for (let i = 0; i < n; i++) re[i] = signal[i] * window[i];

  fftInPlace(re, im);

  const half = fftSize / 2;
  const freqs = new Float32Array(half + 1);
  const mags = new Float32Array(half + 1);
  for (let k = 0; k <= half; k++) {
    freqs[k] = (k * sampleRateHz) / fftSize;
    mags[k] = Math.hypot(re[k], im[k]);
  }
  return { freqs, mags };
}
