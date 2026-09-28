import { CameraCapture } from "./camera/cameraCapture";
import { tryLockExposureAndWhiteBalance } from "./camera/exposureLock";
import { loadFaceLandmarker, detectForVideo } from "./face/faceLandmarker";
import { RoiExtractor, shrinkPolygon, computeForeheadPolygon, ROI_SHRINK_FACTOR } from "./roi/roiExtractor";
import { LEFT_CHEEK_POLYGON, RIGHT_CHEEK_POLYGON } from "./face/landmarkIndices";
import {
  mountDebugOverlay,
  drawRoiOverlay,
  renderReadout,
  type PolygonOverlay,
} from "./debug/debugOverlay";
import { drawWaveform } from "./debug/waveformCanvas";
import { drawSpectrum } from "./debug/spectrumCanvas";
import { SessionRecorder } from "./debug/sessionRecorder";
import { DEFAULT_SIGNAL_CONFIG } from "./config/signalConfig";
import { AppController } from "./app/appController";
import type { ToWorker, FromWorker, PipelineResult } from "./worker/messages";
import type { RoiSample } from "./roi/types";

const root = document.getElementById("app");
if (!root) throw new Error("missing #app root");

const params = new URLSearchParams(window.location.search);
const debugMode = params.get("debug") === "1";

if (!debugMode) {
  new AppController(root).start();
} else {
  void runDebugHarness(root);
}

async function runDebugHarness(rootEl: HTMLElement): Promise<void> {
  const camera = new CameraCapture();
  const handles = mountDebugOverlay(rootEl, camera.video);

  handles.hint.textContent = "Requesting camera permission...";

  try {
    await camera.start(DEFAULT_SIGNAL_CONFIG.camera);
  } catch (err) {
    handles.hint.textContent = `Camera error: ${(err as Error).message}`;
    return;
  }
  handles.hint.textContent = "Loading face tracker...";

  let exposureLockStatus = "warming up (3s)...";
  const track = camera.getVideoTrack();
  if (track) {
    tryLockExposureAndWhiteBalance(track).then((result) => {
      exposureLockStatus = result.details;
    });
  } else {
    exposureLockStatus = "no video track";
  }

  const landmarker = await loadFaceLandmarker();
  const roiExtractor = new RoiExtractor(320);
  handles.hint.textContent = "";

  const worker = new Worker(new URL("./worker/signalWorker.ts", import.meta.url), {
    type: "module",
  });

  const recorder = new SessionRecorder(DEFAULT_SIGNAL_CONFIG);
  handles.recordButton.addEventListener("click", () => {
    recorder.downloadAsFile();
  });

  let latestResult: PipelineResult | null = null;
  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    if (event.data.type === "result") {
      latestResult = event.data.payload;
      recorder.recordResult(event.data.payload);
    }
  };

  const configMsg: ToWorker = { type: "config", config: DEFAULT_SIGNAL_CONFIG };
  worker.postMessage(configMsg);

  let pending: RoiSample[] = [];
  const flushIntervalMs = 100;
  setInterval(() => {
    if (pending.length === 0) return;
    const msg: ToWorker = { type: "samples", samples: pending };
    worker.postMessage(msg);
    pending = [];
  }, flushIntervalMs);

  let faceDetected = false;
  let noFaceSinceMs: number | null = null;

  camera.onFrame((video, tMs) => {
    const detection = detectForVideo(landmarker, video, tMs);
    const sample = roiExtractor.extract(video, detection, tMs);
    pending.push(sample);
    recorder.recordSample(sample);

    faceDetected = sample.faceDetected;
    if (!faceDetected) {
      if (noFaceSinceMs === null) noFaceSinceMs = tMs;
    } else {
      noFaceSinceMs = null;
    }

    const landmarks = detection.faceLandmarks?.[0];
    // Shrunk to match exactly what RoiExtractor samples (see ROI_SHRINK_FACTOR) —
    // otherwise this overlay would show a larger boundary than what's actually read.
    const polygons: PolygonOverlay[] = landmarks
      ? [
          {
            points: shrinkPolygon(computeForeheadPolygon((i) => landmarks[i]), ROI_SHRINK_FACTOR),
            color: "#7fd1c9",
          },
          {
            points: shrinkPolygon(LEFT_CHEEK_POLYGON.map((i) => landmarks[i]), ROI_SHRINK_FACTOR),
            color: "#e0a458",
          },
          {
            points: shrinkPolygon(RIGHT_CHEEK_POLYGON.map((i) => landmarks[i]), ROI_SHRINK_FACTOR),
            color: "#e0a458",
          },
        ]
      : [];
    drawRoiOverlay(handles.overlayCanvas, video, polygons, faceDetected);

    if (!faceDetected && noFaceSinceMs !== null && tMs - noFaceSinceMs > 2000) {
      handles.hint.textContent = "Face not detected — center your face in frame.";
    } else {
      handles.hint.textContent = "";
    }

    renderReadout(handles.readout, {
      fps: camera.getFps().toFixed(1),
      rvfc: camera.isUsingRvfc(),
      faceDetected,
      exposureLock: exposureLockStatus,
      ...readoutFromResult(latestResult),
    });

    handles.recordStatus.textContent = `${recorder.sampleCount()} samples, ${recorder.resultCount()} ticks recorded`;

    if (latestResult) {
      drawWaveform(handles.waveformCanvas, latestResult.bvpTail);
      drawSpectrum(
        handles.spectrumCanvas,
        latestResult.spectrum.freqs,
        latestResult.spectrum.mags,
        DEFAULT_SIGNAL_CONFIG.filter.bandpassLowHz,
        DEFAULT_SIGNAL_CONFIG.filter.bandpassHighHz,
        latestResult.hr.bpm !== null ? latestResult.hr.bpm / 60 : null,
      );
    }
  });

  camera.resume();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      camera.pause();
    } else {
      camera.resume();
    }
  });
}

function readoutFromResult(
  result: PipelineResult | null,
): Record<string, string | number | boolean> {
  if (!result) {
    return { status: "warming up..." };
  }
  const hrText =
    result.hr.bpm !== null
      ? `${result.hr.bpm.toFixed(1)} bpm${result.hr.stable ? " (stable)" : ""}`
      : "--";
  const acfText =
    result.hr.acfFreqHz !== null
      ? `${(result.hr.acfFreqHz * 60).toFixed(1)} bpm (conf ${result.hr.acfConfidence?.toFixed(2)})`
      : "--";
  const ensembleText =
    result.hr.ensembleSpreadBpm !== null
      ? `±${result.hr.ensembleSpreadBpm.toFixed(1)} bpm (n=${result.hr.ensembleCount})`
      : "--";
  const poseText = `${(result.diagnostics.poseFreqHz * 60).toFixed(1)} bpm (snr ${result.diagnostics.poseSnrDb.toFixed(1)})${result.sqi.poseArtifactSuspected ? " <- MATCHES HR, suspect breathing/motion artifact" : ""}`;
  const poseLowText = `${(result.diagnostics.poseLowFreqHz * 60).toFixed(1)} breaths/min-equiv (snr ${result.diagnostics.poseLowSnrDb.toFixed(1)})`;

  return {
    segmentId: result.segmentId,
    validSeconds: result.validSeconds,
    hr: hrText,
    acfCheck: acfText,
    ensembleSpread: ensembleText,
    poseFreq: poseText,
    poseLowFreq: poseLowText,
    poseArtifactSuspected: result.sqi.poseArtifactSuspected,
    snrDb: result.sqi.snrDb.toFixed(1),
    motionFailFrac: result.sqi.motionPassFrac.toFixed(2),
    yawDeg: result.sqi.yawDeg.toFixed(1),
    pitchDeg: result.sqi.pitchDeg.toFixed(1),
    saturationPct: result.sqi.satPct.toFixed(1),
    coveragePct: result.sqi.coveragePct.toFixed(1),
    sqiAllPass: result.sqi.allPass,
  };
}
