export function drawSpectrum(
  canvas: HTMLCanvasElement,
  freqs: number[],
  mags: number[],
  bandLowHz: number,
  bandHighHz: number,
  peakHz: number | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, 0, width, height);

  const indices: number[] = [];
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] >= bandLowHz && freqs[i] <= bandHighHz) indices.push(i);
  }
  if (indices.length === 0) return;

  let maxMag = 0;
  for (const i of indices) if (mags[i] > maxMag) maxMag = mags[i];
  if (maxMag === 0) maxMag = 1;

  ctx.fillStyle = "#3f8f88";
  const barWidth = width / indices.length;
  indices.forEach((idx, j) => {
    const barHeight = (mags[idx] / maxMag) * height;
    ctx.fillRect(j * barWidth, height - barHeight, Math.max(1, barWidth - 1), barHeight);
  });

  if (peakHz !== null) {
    const bandSpan = bandHighHz - bandLowHz || 1;
    const x = ((peakHz - bandLowHz) / bandSpan) * width;
    ctx.strokeStyle = "#e0a458";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}
