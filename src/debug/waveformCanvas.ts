export function drawWaveform(canvas: HTMLCanvasElement, values: number[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, 0, width, height);

  if (values.length < 2) return;

  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;

  ctx.strokeStyle = "#7fd1c9";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < values.length; i++) {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((values[i] - min) / range) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
