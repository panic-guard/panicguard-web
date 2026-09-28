import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";

// Self-hosted (public/models/) rather than fetched from jsdelivr/Google's
// CDN at runtime: CDN latency to this model file (~3.7MB) has been
// unpredictable in testing, and since face-landmarker loading now happens
// inside the same 60s measurement budget (see MeasurementSession), slow
// CDN fetches were eating directly into how much real camera data the
// pipeline gets to work with — a likely cause of low-confidence HR readings
// that had nothing to do with the signal-processing code itself.
const WASM_BASE = "/models/wasm";
const MODEL_URL = "/models/face_landmarker.task";

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

export function loadFaceLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const filesetResolver = await FilesetResolver.forVisionTasks(WASM_BASE);
      return FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true,
      });
    })();
  }
  return landmarkerPromise;
}

export function detectForVideo(
  landmarker: FaceLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
): FaceLandmarkerResult {
  return landmarker.detectForVideo(video, timestampMs);
}
