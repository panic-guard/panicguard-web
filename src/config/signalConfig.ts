export interface SignalConfig {
  camera: { width: number; height: number; fps: number };
  pos: { windowSamples: number; sampleRateHz: number };
  filter: {
    bandpassLowHz: number;
    bandpassHighHz: number;
    order: number;
    detrendWindowSec: number;
  };
  discontinuity: { gapMs: number; brightnessJumpPct: number };
  sqi: {
    windowSec: number;
    updateSec: number;
    thresholds: {
      snrDbMin: number;
      motionRatioMax: number;
      motionFrameFailPctMax: number;
      yawMaxDeg: number;
      pitchMaxDeg: number;
      saturationPctMax: number;
      coveragePctMin: number;
      /** Min SNR the head-pitch signal's own dominant frequency needs before it's trusted as a real periodic motion (not noise). */
      poseArtifactSnrDbMin: number;
      /** Max |Hz| between the pitch signal's dominant frequency (or one of its harmonics) and the candidate HR before flagging suspected motion/breathing contamination. */
      poseArtifactMatchToleranceHz: number;
      /** Search range for the pose signal's below-cardiac-band dominant frequency (breathing rate). */
      poseLowBandLowHz: number;
      poseLowBandHighHz: number;
      /** Highest harmonic multiple of the low-band pose frequency to check against the candidate HR. */
      poseArtifactHarmonicsMax: number;
    };
  };
  hr: {
    /**
     * Multi-scale ensemble: each tick, estimate frequency independently over
     * several trailing windows of these lengths (all right-aligned to "now"),
     * then take the MEDIAN bpm across them. A transient artifact (motion
     * blip, brief specular flash) skews a short window a lot but is diluted
     * in a long window, and vice versa for slow drift — the median rejects
     * whichever scale it distorted most that tick.
     */
    ensembleWindowSecs: number[];
    /** If the ensemble's own max-min spread is within this, trust a big jump immediately instead of requiring multi-tick confirmation. */
    ensembleTightSpreadBpm: number;
    fftSize: number;
    updateSec: number;
    /** Min power ratio (vs. the FFT peak) an f0/2 or f0*2 candidate needs before ACF is allowed to redirect the estimate to it — guards against ACF's own errors pulling toward a frequency the spectrum has no real evidence for. */
    harmonicPowerRatio: number;
    outlierJumpBpm: number;
    outlierConfirmSec: number;
    stabilityWindowCount: number;
    stabilityIqrBpm: number;
    /** Minimum autocorrelation confidence to trust it for harmonic disambiguation. */
    acfConfidenceMin: number;
    /** Max |Hz| between an FFT harmonic candidate and the ACF estimate to accept a switch. */
    acfMatchToleranceHz: number;
    /** ACF octave-error guard: prefer the shortest lag whose correlation is at least this fraction of the global max. */
    acfOctavePreferenceRatio: number;
    /** Min power ratio (vs. the top peak) for a second spectral peak to count as a near-tie, allowing the previous committed bpm to break the tie. */
    nearTiePowerRatio: number;
  };
  /**
   * Spec's own thresholds are explicitly design heuristics, not clinically
   * validated cutoffs — "모든 수치 기준은 설계 휴리스틱(초기값)". 20s was the
   * initial guess; real recorded sessions show 7 of 8 never reached it
   * (SQI pass rate is often 2-18%, so 20 accumulated valid seconds inside a
   * 60s attempt is frequently unreachable even under fine conditions) — one
   * of those sub-20 sessions (14 valid seconds) was independently checked
   * against a watch and was accurate. Lowered to reflect what's actually
   * achievable without weakening the real safety gate, which is
   * hr.stable's own 10-commit IQR check (worker/hrEstimate.ts) — that stays
   * unchanged and is what actually vouches for consistency.
   */
  ready: { minValidSeconds: number };
}

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  camera: { width: 640, height: 480, fps: 30 },
  pos: { windowSamples: 48, sampleRateHz: 30 },
  filter: {
    bandpassLowHz: 0.7,
    bandpassHighHz: 3.5,
    order: 3,
    detrendWindowSec: 1,
  },
  discontinuity: { gapMs: 100, brightnessJumpPct: 3 },
  sqi: {
    windowSec: 10,
    updateSec: 1,
    thresholds: {
      snrDbMin: 0,
      motionRatioMax: 0.02,
      motionFrameFailPctMax: 0.2,
      yawMaxDeg: 25,
      pitchMaxDeg: 25,
      saturationPctMax: 5,
      coveragePctMin: 80,
      poseArtifactSnrDbMin: 0,
      poseArtifactMatchToleranceHz: 0.15,
      poseLowBandLowHz: 0.15,
      poseLowBandHighHz: 0.6,
      poseArtifactHarmonicsMax: 5,
    },
  },
  hr: {
    ensembleWindowSecs: [6, 8, 10, 13],
    ensembleTightSpreadBpm: 8,
    fftSize: 2048,
    updateSec: 1,
    harmonicPowerRatio: 0.25,
    outlierJumpBpm: 15,
    outlierConfirmSec: 3,
    stabilityWindowCount: 10,
    stabilityIqrBpm: 6,
    acfConfidenceMin: 0.35,
    acfMatchToleranceHz: 0.12,
    acfOctavePreferenceRatio: 0.75,
    nearTiePowerRatio: 0.7,
  },
  ready: { minValidSeconds: 12 },
};

export function resolveConfig(overrides?: Partial<SignalConfig>): SignalConfig {
  if (!overrides) return DEFAULT_SIGNAL_CONFIG;
  return {
    camera: { ...DEFAULT_SIGNAL_CONFIG.camera, ...overrides.camera },
    pos: { ...DEFAULT_SIGNAL_CONFIG.pos, ...overrides.pos },
    filter: { ...DEFAULT_SIGNAL_CONFIG.filter, ...overrides.filter },
    discontinuity: { ...DEFAULT_SIGNAL_CONFIG.discontinuity, ...overrides.discontinuity },
    sqi: {
      ...DEFAULT_SIGNAL_CONFIG.sqi,
      ...overrides.sqi,
      thresholds: {
        ...DEFAULT_SIGNAL_CONFIG.sqi.thresholds,
        ...overrides.sqi?.thresholds,
      },
    },
    hr: { ...DEFAULT_SIGNAL_CONFIG.hr, ...overrides.hr },
    ready: { ...DEFAULT_SIGNAL_CONFIG.ready, ...overrides.ready },
  };
}
