export interface DebugOverlayHandles {
  overlayCanvas: HTMLCanvasElement;
  waveformCanvas: HTMLCanvasElement;
  spectrumCanvas: HTMLCanvasElement;
  readout: HTMLPreElement;
  hint: HTMLDivElement;
  recordButton: HTMLButtonElement;
  recordStatus: HTMLSpanElement;
}

const STYLE = `
  .pg-debug-root {
    background: #0b0f14;
    color: #d7dee3;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    min-height: 100vh;
    padding: 16px;
    box-sizing: border-box;
  }
  .pg-debug-video-wrap {
    position: relative;
    width: 480px;
    max-width: 100%;
  }
  .pg-debug-video-wrap video,
  .pg-debug-video-wrap canvas.pg-overlay {
    width: 100%;
    display: block;
    border-radius: 8px;
  }
  .pg-debug-video-wrap canvas.pg-overlay {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }
  .pg-debug-hint {
    margin-top: 8px;
    font-size: 13px;
    color: #f0b0b0;
    min-height: 18px;
  }
  .pg-debug-row {
    display: flex;
    gap: 16px;
    margin-top: 16px;
    flex-wrap: wrap;
  }
  .pg-debug-panel {
    background: #10161d;
    border-radius: 8px;
    padding: 8px;
  }
  .pg-debug-panel canvas {
    display: block;
  }
  .pg-debug-readout {
    background: #10161d;
    border-radius: 8px;
    padding: 12px;
    margin-top: 16px;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre;
  }
  .pg-debug-record-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
  }
  .pg-debug-record-row button {
    background: #1c2733;
    color: #d7dee3;
    border: 1px solid #33465a;
    border-radius: 6px;
    padding: 6px 12px;
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .pg-debug-record-row button:hover {
    background: #24313f;
  }
  .pg-debug-record-status {
    font-size: 13px;
    color: #8fa0ad;
  }
`;

export function mountDebugOverlay(root: HTMLElement, video: HTMLVideoElement): DebugOverlayHandles {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  root.innerHTML = "";
  const container = document.createElement("div");
  container.className = "pg-debug-root";

  const videoWrap = document.createElement("div");
  videoWrap.className = "pg-debug-video-wrap";
  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.className = "pg-overlay";
  videoWrap.appendChild(video);
  videoWrap.appendChild(overlayCanvas);
  container.appendChild(videoWrap);

  const hint = document.createElement("div");
  hint.className = "pg-debug-hint";
  container.appendChild(hint);

  const row = document.createElement("div");
  row.className = "pg-debug-row";

  const waveformPanel = document.createElement("div");
  waveformPanel.className = "pg-debug-panel";
  const waveformCanvas = document.createElement("canvas");
  waveformCanvas.width = 400;
  waveformCanvas.height = 120;
  const waveformLabel = document.createElement("div");
  waveformLabel.textContent = "BVP (last 5s)";
  waveformPanel.appendChild(waveformLabel);
  waveformPanel.appendChild(waveformCanvas);
  row.appendChild(waveformPanel);

  const spectrumPanel = document.createElement("div");
  spectrumPanel.className = "pg-debug-panel";
  const spectrumCanvas = document.createElement("canvas");
  spectrumCanvas.width = 400;
  spectrumCanvas.height = 120;
  const spectrumLabel = document.createElement("div");
  spectrumLabel.textContent = "Spectrum (0.7-3.5Hz)";
  spectrumPanel.appendChild(spectrumLabel);
  spectrumPanel.appendChild(spectrumCanvas);
  row.appendChild(spectrumPanel);

  container.appendChild(row);

  const readout = document.createElement("pre");
  readout.className = "pg-debug-readout";
  container.appendChild(readout);

  const recordRow = document.createElement("div");
  recordRow.className = "pg-debug-record-row";
  const recordButton = document.createElement("button");
  recordButton.type = "button";
  recordButton.textContent = "Download session data";
  const recordStatus = document.createElement("span");
  recordStatus.className = "pg-debug-record-status";
  recordRow.appendChild(recordButton);
  recordRow.appendChild(recordStatus);
  container.appendChild(recordRow);

  root.appendChild(container);

  return { overlayCanvas, waveformCanvas, spectrumCanvas, readout, hint, recordButton, recordStatus };
}

export function renderInstructionOnly(root: HTMLElement): void {
  root.innerHTML = "";
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);
  const container = document.createElement("div");
  container.className = "pg-debug-root";
  container.textContent =
    "PanicGuard Web — signal-processing debug harness. Append ?debug=1 to the URL to run it.";
  root.appendChild(container);
}

export interface PolygonOverlay {
  points: { x: number; y: number }[];
  color: string;
}

export function drawRoiOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  polygons: PolygonOverlay[],
  faceDetected: boolean,
): void {
  const displayWidth = video.clientWidth || video.videoWidth;
  const displayHeight = video.clientHeight || video.videoHeight;
  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!faceDetected) return;

  for (const poly of polygons) {
    if (poly.points.length === 0) continue;
    ctx.strokeStyle = poly.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    poly.points.forEach((p, i) => {
      const x = p.x * canvas.width;
      const y = p.y * canvas.height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }
}

export function renderReadout(pre: HTMLPreElement, data: Record<string, string | number | boolean>): void {
  pre.textContent = Object.entries(data)
    .map(([k, v]) => `${k.padEnd(16)} ${v}`)
    .join("\n");
}
