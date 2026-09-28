import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import {
  LEFT_CHEEK_POLYGON,
  RIGHT_CHEEK_POLYGON,
  MOTION_TRACK_SET,
  LEFT_EYE_OUTER,
  RIGHT_EYE_OUTER,
  FOREHEAD_HAIRLINE_TOP,
  GLABELLA,
  LEFT_EYEBROW_OUTER,
  LEFT_EYEBROW_INNER,
  RIGHT_EYEBROW_OUTER,
  RIGHT_EYEBROW_INNER,
} from "../face/landmarkIndices";
import type { RoiColor, RoiSample } from "./types";

export interface Point {
  x: number;
  y: number;
}

const SATURATION_CHANNEL_THRESHOLD = 250;

/**
 * Shrink each ROI polygon toward its centroid by this fraction before
 * sampling pixels. Confirmed via a real recorded session: the fast,
 * cardiac-band-relevant frame-to-frame fluctuations in forehead/left-cheek/
 * right-cheek were almost completely uncorrelated with each other
 * (Pearson ~0.1-0.4) even though the slow-moving raw brightness was highly
 * correlated (~0.96-0.99) — i.e. each ROI's noise is local to it, not a
 * shared camera-wide effect. The landmark indices in landmarkIndices.ts are
 * still an unverified first approximation; shrinking the sampled area
 * inward is a standard, low-risk mitigation for exactly this failure mode
 * (a polygon edge occasionally grazing hairline/eyebrow/shadow/background
 * is enough to dominate a signal this subtle) while the indices themselves
 * get tuned against the debug overlay.
 */
export const ROI_SHRINK_FACTOR = 0.3;

/**
 * The forehead polygon's raw eyebrow-landmark vertices sit right on the
 * eyebrow line — confirmed visually (via the debug overlay) to include
 * eyebrow hair, not just skin. A uniform centroid shrink doesn't reliably
 * clear this for a vertically-short region like the forehead.
 *
 * A first attempt lerped all 5 eyebrow-line points toward the single
 * hairline-top landmark (10) — but with only ONE point representing the
 * entire upper boundary, that's a fan/triangle converging on that one
 * point, not a region with real area; pulling the base up toward the apex
 * by 40% collapsed it into the "small triangle" seen in the debug overlay.
 *
 * Build an actual rectangle instead: horizontal extent from the left to
 * right eyebrow-outer landmarks' x, vertical extent between the eyebrow
 * line's y and the hairline's y (each inset by a margin so neither edge
 * sits exactly on the eyebrows or the hairline). This only trusts each
 * landmark for the one axis it's reliable on (eyebrow x-spread, brow-to-
 * hairline y-span), so it can't degenerate the way a point-to-point lerp
 * chain can.
 */
export function computeForeheadPolygon(getPoint: (idx: number) => Point): Point[] {
  const hairline = getPoint(FOREHEAD_HAIRLINE_TOP);
  const glabella = getPoint(GLABELLA);
  const leftOuter = getPoint(LEFT_EYEBROW_OUTER);
  const leftInner = getPoint(LEFT_EYEBROW_INNER);
  const rightOuter = getPoint(RIGHT_EYEBROW_OUTER);
  const rightInner = getPoint(RIGHT_EYEBROW_INNER);

  const LOWER_MARGIN = 0.35; // fraction of the brow-to-hairline gap to clear above the eyebrows
  const UPPER_MARGIN = 0.15; // fraction of the same gap to stay clear of the hairline

  const browY = (leftOuter.y + leftInner.y + rightOuter.y + rightInner.y + glabella.y) / 5;
  const hairY = hairline.y;
  const gap = browY - hairY; // positive when brows are below the hairline, as expected

  const lowerY = browY - gap * LOWER_MARGIN;
  const upperY = hairY + gap * UPPER_MARGIN;
  const leftX = leftOuter.x;
  const rightX = rightOuter.x;

  return [
    { x: leftX, y: lowerY },
    { x: leftX, y: upperY },
    { x: rightX, y: upperY },
    { x: rightX, y: lowerY },
  ];
}

/**
 * Extracts per-ROI mean RGB (and a few pose/motion signals) from a video
 * frame + FaceLandmarker result, on a downscaled off-DOM canvas. Runs on the
 * main thread; only the returned RoiSample (small numbers) crosses into the
 * signal-processing worker — never raw pixels or the full landmark set.
 */
export class RoiExtractor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private outputWidth: number;

  constructor(outputWidth = 320) {
    this.outputWidth = outputWidth;
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
  }

  extract(
    video: HTMLVideoElement,
    result: FaceLandmarkerResult | null,
    t: number,
  ): RoiSample {
    const vw = video.videoWidth || this.outputWidth;
    const vh = video.videoHeight || Math.round(this.outputWidth * 0.75);
    const scale = this.outputWidth / vw;
    const cw = Math.round(vw * scale);
    const ch = Math.round(vh * scale);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    this.ctx.drawImage(video, 0, 0, cw, ch);

    const bg = this.readBackgroundRoi(cw, ch);

    const landmarks = result?.faceLandmarks?.[0];
    if (!landmarks || landmarks.length === 0) {
      return {
        t,
        faceDetected: false,
        forehead: zeroColor(),
        leftCheek: zeroColor(),
        rightCheek: zeroColor(),
        bg,
        pose: { yawDeg: 0, pitchDeg: 0 },
        motionLandmarks: [],
        interocularPx: 0,
      };
    }

    const toPx = (idx: number): Point => ({
      x: landmarks[idx].x * cw,
      y: landmarks[idx].y * ch,
    });

    const forehead = this.readPolygonRoi(shrinkPolygon(computeForeheadPolygon(toPx), ROI_SHRINK_FACTOR));
    const leftCheek = this.readPolygonRoi(shrinkPolygon(LEFT_CHEEK_POLYGON.map(toPx), ROI_SHRINK_FACTOR));
    const rightCheek = this.readPolygonRoi(shrinkPolygon(RIGHT_CHEEK_POLYGON.map(toPx), ROI_SHRINK_FACTOR));

    const motionLandmarks: number[] = [];
    for (const idx of MOTION_TRACK_SET) {
      const p = toPx(idx);
      motionLandmarks.push(p.x, p.y);
    }

    const leftEye = toPx(LEFT_EYE_OUTER);
    const rightEye = toPx(RIGHT_EYE_OUTER);
    const interocularPx = Math.hypot(
      rightEye.x - leftEye.x,
      rightEye.y - leftEye.y,
    );

    const transform = result?.facialTransformationMatrixes?.[0]?.data;
    const pose = transform ? computePoseDeg(transform) : { yawDeg: 0, pitchDeg: 0 };

    return {
      t,
      faceDetected: true,
      forehead,
      leftCheek,
      rightCheek,
      bg,
      pose,
      motionLandmarks,
      interocularPx,
    };
  }

  private readPolygonRoi(polygon: Point[]): RoiColor {
    const bbox = polygonBbox(polygon, this.canvas.width, this.canvas.height);
    if (bbox.w <= 0 || bbox.h <= 0) return zeroColor();

    const image = this.ctx.getImageData(bbox.x, bbox.y, bbox.w, bbox.h);
    const data = image.data;

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;
    let satCount = 0;

    for (let py = 0; py < bbox.h; py++) {
      const worldY = bbox.y + py + 0.5;
      for (let px = 0; px < bbox.w; px++) {
        const worldX = bbox.x + px + 0.5;
        if (!pointInPolygon(worldX, worldY, polygon)) continue;
        const i = (py * bbox.w + px) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        sumR += r;
        sumG += g;
        sumB += b;
        count++;
        if (
          r >= SATURATION_CHANNEL_THRESHOLD ||
          g >= SATURATION_CHANNEL_THRESHOLD ||
          b >= SATURATION_CHANNEL_THRESHOLD
        ) {
          satCount++;
        }
      }
    }

    if (count === 0) return zeroColor();
    return {
      r: sumR / count,
      g: sumG / count,
      b: sumB / count,
      satPct: (satCount / count) * 100,
    };
  }

  private readBackgroundRoi(cw: number, ch: number): { r: number; g: number; b: number } {
    const regionW = Math.max(1, Math.round(cw / 6));
    const regionH = Math.max(1, Math.round(ch / 8));
    const left = this.ctx.getImageData(0, 0, regionW, regionH);
    const right = this.ctx.getImageData(cw - regionW, 0, regionW, regionH);

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;
    for (const img of [left, right]) {
      const data = img.data;
      for (let i = 0; i < data.length; i += 4) {
        sumR += data[i];
        sumG += data[i + 1];
        sumB += data[i + 2];
        count++;
      }
    }
    if (count === 0) return { r: 0, g: 0, b: 0 };
    return { r: sumR / count, g: sumG / count, b: sumB / count };
  }
}

/** Moves each vertex `factor` of the way toward the polygon's centroid. */
export function shrinkPolygon(polygon: Point[], factor: number): Point[] {
  if (polygon.length === 0) return polygon;
  const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
  const cy = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
  return polygon.map((p) => ({
    x: p.x + (cx - p.x) * factor,
    y: p.y + (cy - p.y) * factor,
  }));
}

function zeroColor(): RoiColor {
  return { r: 0, g: 0, b: 0, satPct: 0 };
}

function polygonBbox(polygon: Point[], maxW: number, maxH: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  const x2 = Math.min(maxW, Math.ceil(maxX));
  const y2 = Math.min(maxH, Math.ceil(maxY));
  return { x, y, w: x2 - x, h: y2 - y };
}

// Ray-casting point-in-polygon test.
function pointInPolygon(x: number, y: number, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Head pose (yaw/pitch, degrees) from MediaPipe's row-major 4x4 facial
 * transformation matrix, via a YXZ Euler decomposition. Sign/magnitude
 * conventions should be spot-checked in the ?debug=1 overlay (turn head
 * left/right and confirm yaw sign, nod and confirm pitch sign).
 */
function computePoseDeg(m: Float32Array | number[]): { yawDeg: number; pitchDeg: number } {
  const m02 = m[2];
  const m10 = m[4];
  const m12 = m[6];
  const m20 = m[8];
  const m22 = m[10];

  const clamped = Math.max(-1, Math.min(1, m12));
  const pitch = Math.asin(-clamped);

  let yaw: number;
  if (Math.abs(m12) < 0.9999999) {
    yaw = Math.atan2(m02, m22);
  } else {
    yaw = Math.atan2(-m20, m10);
  }

  return {
    yawDeg: (yaw * 180) / Math.PI,
    pitchDeg: (pitch * 180) / Math.PI,
  };
}
