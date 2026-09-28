export type Locale = "en";
export type Grade = "A" | "B" | "C" | "C_PLUS";

export interface AssessRequest {
  locale: Locale;
  triage: {
    suds: number;
    recent_exertion: boolean;
    flags: string[];
  };
  metrics: {
    hr_bpm: number | null;
    hr_confidence: "high" | "low";
    rr_rpm: number | null;
    valid_seconds: number;
    baseline_hr_bpm: number | null;
  };
  rule_result: {
    grade: Grade;
    advisories: string[];
    breathing_start_rate: number;
  };
}

export interface AssessResponse {
  headline: string;
  message_lines: string[];
  /** Gemini may only ever request raising the grade one step — never lowering it, and it never touches the safety path. The rule engine's own grade stays authoritative either way; the client is not required to act on this. */
  intensity_adjustment: "none" | "raise";
}

export interface SummaryRequest {
  locale: Locale;
  suds_pre: number;
  suds_post: number;
  hr_start: number | null;
  hr_end: number | null;
  hr_confidence: "high" | "low";
  breathing_seconds: number;
}

export interface SummaryResponse {
  headline: string;
  message_lines: string[];
}
