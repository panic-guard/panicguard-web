export type RedFlag = "chest_pain_radiating" | "syncope" | "known_heart_disease" | "first_episode";

export interface TriageInput {
  suds: number; // 0-10, self-reported distress
  recentExertion: boolean;
  flags: RedFlag[];
}

export interface Metrics {
  hrBpm: number | null;
  hrConfidence: "high" | "low";
  rrRpm: number | null;
  validSeconds: number;
}

export type Grade = "A" | "B" | "C" | "C_PLUS";
export type Advisory = "advisory_high_hr" | "advisory_low_hr" | "advisory_first_episode";

export interface RuleResult {
  safety: boolean;
  advisories: Advisory[];
  grade: Grade | null; // null when safety is true — grade is not applicable
  breathingStartRateRpm: 6 | 8;
}

/**
 * Deterministic, single source of truth for safety routing and intervention
 * grade. Gemini (once wired up) may only ever request raising the grade one
 * step, never lowering it, and never touches the safety path — see spec §6.1/7.1.
 */
export function isSafetyRoute(t: TriageInput): boolean {
  if (t.flags.includes("chest_pain_radiating") || t.flags.includes("syncope")) return true;
  if (t.flags.includes("first_episode") && t.flags.includes("known_heart_disease")) return true;
  return false;
}

export function computeAdvisories(t: TriageInput, m: Metrics): Advisory[] {
  const advisories: Advisory[] = [];
  const hrHighConfidence = m.hrBpm !== null && m.hrConfidence === "high";

  if (!t.recentExertion && hrHighConfidence && m.hrBpm! >= 150 && m.validSeconds >= 20) {
    advisories.push("advisory_high_hr");
  }
  if (hrHighConfidence && m.hrBpm! < 45) {
    advisories.push("advisory_low_hr");
  }
  if (t.flags.includes("first_episode") && !t.flags.includes("known_heart_disease")) {
    advisories.push("advisory_first_episode");
  }
  return advisories;
}

export function computeGrade(t: TriageInput, m: Metrics, baselineHrBpm: number | null): Grade {
  if (t.suds <= 3) return "A";

  const hrUsable = m.hrBpm !== null && m.hrConfidence === "high" && !t.recentExertion;
  const hrElevated =
    hrUsable && (baselineHrBpm !== null ? m.hrBpm! - baselineHrBpm >= 15 : m.hrBpm! >= 100);
  const rrElevated = m.rrRpm !== null && m.rrRpm > 20;
  const rrHigh = m.rrRpm !== null && m.rrRpm > 24;

  if (hrElevated || rrElevated) {
    if (t.suds >= 7 && (rrHigh || (hrUsable && m.hrBpm! >= 120))) return "C_PLUS";
    return "C";
  }

  if (!hrUsable && t.suds >= 7) return "C";
  return "B";
}

export function evaluateRules(t: TriageInput, m: Metrics, baselineHrBpm: number | null): RuleResult {
  if (isSafetyRoute(t)) {
    return { safety: true, advisories: [], grade: null, breathingStartRateRpm: 6 };
  }
  const grade = computeGrade(t, m, baselineHrBpm);
  return {
    safety: false,
    advisories: computeAdvisories(t, m),
    grade,
    breathingStartRateRpm: grade === "C_PLUS" ? 8 : 6,
  };
}
