import type { Grade } from "../rules/ruleEngine";

/**
 * When VITE_API_BASE_URL is unset (the default for local/dev builds and for
 * anyone who hasn't deployed the Cloud Run backend), every function here
 * resolves to null immediately with no network attempt — the app behaves
 * exactly as it did before this file existed, falling back to the static
 * templates in templates.ts.
 */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = 3500;

export interface AssessCopyRequest {
  suds: number;
  recentExertion: boolean;
  flags: string[];
  hrBpm: number | null;
  hrConfidence: "high" | "low";
  rrRpm: number | null;
  validSeconds: number;
  baselineHrBpm: number | null;
  grade: Grade;
  advisories: string[];
  breathingStartRateRpm: number;
}

export interface AssessCopyResult {
  headline: string;
  lines: string[];
  intensityAdjustment: "none" | "raise";
}

export interface SummaryCopyRequest {
  sudsPre: number;
  sudsPost: number;
  hrStart: number | null;
  hrEnd: number | null;
  hrConfidence: "high" | "low";
  breathingSeconds: number;
}

export interface SummaryCopyResult {
  headline: string;
  lines: string[];
}

async function postJson(path: string, body: unknown): Promise<unknown | null> {
  if (!API_BASE_URL) return null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Network error, timeout, or malformed response — the caller falls
    // back to its own static template. Never surface this as a user error.
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchAssessCopy(req: AssessCopyRequest): Promise<AssessCopyResult | null> {
  const raw = await postJson("/api/assess", {
    locale: "en",
    triage: { suds: req.suds, recent_exertion: req.recentExertion, flags: req.flags },
    metrics: {
      hr_bpm: req.hrBpm,
      hr_confidence: req.hrConfidence,
      rr_rpm: req.rrRpm,
      valid_seconds: req.validSeconds,
      baseline_hr_bpm: req.baselineHrBpm,
    },
    rule_result: {
      grade: req.grade,
      advisories: req.advisories,
      breathing_start_rate: req.breathingStartRateRpm,
    },
  });
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.headline !== "string" || !Array.isArray(r.message_lines)) return null;
  if (!r.message_lines.every((l) => typeof l === "string")) return null;
  return {
    headline: r.headline,
    lines: r.message_lines as string[],
    intensityAdjustment: r.intensity_adjustment === "raise" ? "raise" : "none",
  };
}

export async function fetchSummaryCopy(req: SummaryCopyRequest): Promise<SummaryCopyResult | null> {
  const raw = await postJson("/api/summary", {
    locale: "en",
    suds_pre: req.sudsPre,
    suds_post: req.sudsPost,
    hr_start: req.hrStart,
    hr_end: req.hrEnd,
    hr_confidence: req.hrConfidence,
    breathing_seconds: req.breathingSeconds,
  });
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.headline !== "string" || !Array.isArray(r.message_lines)) return null;
  if (!r.message_lines.every((l) => typeof l === "string")) return null;
  return { headline: r.headline, lines: r.message_lines as string[] };
}
