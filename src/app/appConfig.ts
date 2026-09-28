export const APP_CONFIG = {
  holding: {
    /** How long each cycling grounding-lite phrase is shown for. */
    phraseCycleMs: 7000,
    /** When the "continue without waiting" button appears. */
    showSkipButtonMs: 10000,
    /** When it becomes visually emphasized (face lost for this long). */
    emphasizeSkipAfterNoFaceMs: 15000,
  },
  measure: {
    /** Hard stop for the background measurement, regardless of readiness. */
    forceFinishMs: 60000,
  },
  breathing: {
    /** "Finish" is disabled (dimmed) until this much time has passed. */
    finishEnableMs: 60000,
    /** Gentle nudge shown once, after this long. */
    suggestFinishMs: 180000,
  },
  helplines: {
    US: { emergency: "911", crisis: "988" },
    KR: { emergency: "119", crisis: "109" },
  },
} as const;

export type Locale = "en";
