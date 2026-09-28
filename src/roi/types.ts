export interface RoiColor {
  r: number;
  g: number;
  b: number;
  satPct: number;
}

export interface RoiSample {
  t: number;
  faceDetected: boolean;
  forehead: RoiColor;
  leftCheek: RoiColor;
  rightCheek: RoiColor;
  bg: { r: number; g: number; b: number };
  pose: { yawDeg: number; pitchDeg: number };
  motionLandmarks: number[];
  interocularPx: number;
}

export type RoiName = "forehead" | "leftCheek" | "rightCheek";
