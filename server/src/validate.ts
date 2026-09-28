// Spec §7.4 — a Gemini response that fails ANY of these checks is rejected
// wholesale; the caller (client) falls back to its own static template.
// Never partially trust a response.

const BANNED_SUBSTRINGS = [
  "heart attack",
  "diagnos", // catches diagnose/diagnosis/diagnosed
  "you have panic",
  "guarantee",
  "nothing wrong",
  "die",
  "death",
];

const MAX_HEADLINE_WORDS = 8;
const MAX_LINE_WORDS = 10;
const MAX_LINES = 3;

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function containsBannedWord(text: string): string | null {
  const lower = text.toLowerCase();
  for (const banned of BANNED_SUBSTRINGS) {
    if (lower.includes(banned)) return banned;
  }
  return null;
}

/** Every integer appearing in the text must be traceable to a number we actually sent — never let the model hallucinate a figure. */
function findUngroundedNumbers(text: string, allowed: Set<number>): number[] {
  const found = [...text.matchAll(/\d+/g)].map((m) => Number(m[0]));
  return found.filter((n) => !allowed.has(n));
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

function validateCopy(
  headline: unknown,
  messageLines: unknown,
  allowedNumbers: Set<number>,
): ValidationResult {
  if (typeof headline !== "string" || headline.length === 0) {
    return { ok: false, reason: "headline missing or not a string" };
  }
  if (!Array.isArray(messageLines) || messageLines.length < 1 || messageLines.length > MAX_LINES) {
    return { ok: false, reason: "message_lines must be an array of 1-3 strings" };
  }
  if (!messageLines.every((l) => typeof l === "string" && l.length > 0)) {
    return { ok: false, reason: "message_lines contains a non-string or empty entry" };
  }

  if (wordCount(headline) > MAX_HEADLINE_WORDS) {
    return { ok: false, reason: `headline exceeds ${MAX_HEADLINE_WORDS} words` };
  }
  for (const line of messageLines as string[]) {
    if (wordCount(line) > MAX_LINE_WORDS) {
      return { ok: false, reason: `a message line exceeds ${MAX_LINE_WORDS} words` };
    }
  }

  const allText = [headline, ...(messageLines as string[])].join(" ");
  const banned = containsBannedWord(allText);
  if (banned) return { ok: false, reason: `contains banned phrase: "${banned}"` };

  const ungrounded = findUngroundedNumbers(allText, allowedNumbers);
  if (ungrounded.length > 0) {
    return { ok: false, reason: `contains ungrounded number(s): ${ungrounded.join(", ")}` };
  }

  return { ok: true };
}

export function validateAssessResponse(
  body: unknown,
  allowedNumbers: Set<number>,
): ValidationResult {
  if (typeof body !== "object" || body === null) return { ok: false, reason: "not an object" };
  const b = body as Record<string, unknown>;
  const copyResult = validateCopy(b.headline, b.message_lines, allowedNumbers);
  if (!copyResult.ok) return copyResult;
  if (b.intensity_adjustment !== "none" && b.intensity_adjustment !== "raise") {
    return { ok: false, reason: "intensity_adjustment must be 'none' or 'raise'" };
  }
  return { ok: true };
}

export function validateSummaryResponse(
  body: unknown,
  allowedNumbers: Set<number>,
): ValidationResult {
  if (typeof body !== "object" || body === null) return { ok: false, reason: "not an object" };
  const b = body as Record<string, unknown>;
  return validateCopy(b.headline, b.message_lines, allowedNumbers);
}

/** Rounds and collects the numeric fields Gemini is allowed to reference, so it can't cite a figure we never gave it. */
export function allowedNumbersFrom(...values: (number | null | undefined)[]): Set<number> {
  const set = new Set<number>();
  for (const v of values) {
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    set.add(Math.round(v));
  }
  return set;
}
