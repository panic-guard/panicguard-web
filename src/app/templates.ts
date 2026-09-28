import type { Advisory, Grade } from "../rules/ruleEngine";

export interface ResultCopy {
  headline: string;
  lines: string[];
}

/**
 * Static fallback copy (spec §7.5). No Gemini call is made for any of this
 * yet — grounding prompts in particular are intentionally always static,
 * per instruction to keep Gemini calls minimal once that's wired up later.
 */
export const RESULT_TEMPLATES: Record<Grade, ResultCopy> = {
  A: {
    headline: "You're doing okay",
    lines: ["Your body seems fairly calm right now.", "Let's breathe together for a bit."],
  },
  B: {
    headline: "It's okay to feel this",
    lines: ["Your mind feels unsettled.", "Let's ground ourselves, then breathe."],
  },
  C: {
    headline: "Your body is very alert",
    lines: ["You're safe right now.", "Let's take this slowly, together."],
  },
  C_PLUS: {
    headline: "Stay with me",
    lines: ["You're safe.", "Breathe with me."],
  },
};

export const ADVISORY_TEXT: Record<Advisory, string> = {
  advisory_high_hr:
    "Your heart rate measured very fast. The reading could be off, but if this continues, please get medical help.",
  advisory_low_hr:
    "Your heart rate measured very slow. The reading could be off, but if this continues, please get medical help.",
  advisory_first_episode: "Since this is your first time feeling this, a medical check could help too.",
};

export const SAFETY_COPY = {
  headline: "This may need a medical check",
  line: "What you described may need a medical professional to look at.",
  breathingWhileWaiting: "Get breathing help while you wait",
};

export interface GroundingStep {
  sense: "see" | "touch" | "hear" | "smell" | "taste";
  count: number;
  prompt: string;
}

export const DEFAULT_GROUNDING_STEPS: GroundingStep[] = [
  { sense: "see", count: 5, prompt: "Find 5 things you can see around you." },
  { sense: "touch", count: 4, prompt: "Notice 4 things you can touch." },
  { sense: "hear", count: 3, prompt: "Find 3 things you can hear." },
  { sense: "smell", count: 2, prompt: "Notice 2 things you can smell — your sleeve is fine." },
  { sense: "taste", count: 1, prompt: "Notice 1 taste in your mouth — a sip of water works too." },
];

export const GROUNDING_ASSIST_TEXT = "It's okay if you can't find them all.";

export function summaryCopy(sudsPost: number): ResultCopy {
  if (sudsPost >= 7) {
    return {
      headline: "Let's get more support",
      lines: ["This is still a lot right now.", "Consider reaching out to someone you trust."],
    };
  }
  if (sudsPost >= 4) {
    return {
      headline: "You're getting there",
      lines: ["That was hard.", "You can keep breathing, or stop here — either is okay."],
    };
  }
  return {
    headline: "Nice work",
    lines: ["You made it through.", "Be gentle with yourself for the rest of today."],
  };
}

export const PRIVACY_NOTE =
  "Your camera video never leaves this device. Only measured numbers are used to write messages.";
