import express, { type Request, type Response, type NextFunction } from "express";
import { generateJson } from "./geminiClient.js";
import { validateAssessResponse, validateSummaryResponse, allowedNumbersFrom } from "./validate.js";
import { ASSESS_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT } from "./prompts.js";
import { isRateLimited } from "./rateLimiter.js";
import type { AssessRequest, SummaryRequest } from "./types.js";

const app = express();
app.use(express.json({ limit: "16kb" }));

// Permissive by default for this MVP (the client is this app's own static
// site) — tighten to the deployed origin via ALLOWED_ORIGIN once that's
// known, rather than leaving this open indefinitely.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

// Never log request bodies — spec: "서버는 요청 본문을 로깅하지 않는다."
function rateLimitGuard(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip ?? "unknown";
  if (isRateLimited(key)) {
    res.status(429).json({ error: "rate_limited" });
    return;
  }
  next();
}

const ASSESS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    message_lines: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
    intensity_adjustment: { type: "string", enum: ["none", "raise"] },
  },
  required: ["headline", "message_lines", "intensity_adjustment"],
};

const SUMMARY_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    message_lines: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
  },
  required: ["headline", "message_lines"],
};

app.post("/api/assess", rateLimitGuard, async (req: Request, res: Response) => {
  const t0 = Date.now();
  try {
    const body = req.body as AssessRequest;
    if (body.locale !== "en" || !body.triage || !body.metrics || !body.rule_result) {
      res.status(400).json({ error: "malformed request" });
      return;
    }

    const allowed = allowedNumbersFrom(
      body.metrics.hr_bpm,
      body.metrics.rr_rpm,
      body.metrics.baseline_hr_bpm,
    );

    const raw = await generateJson(
      ASSESS_SYSTEM_PROMPT,
      JSON.stringify(body),
      ASSESS_RESPONSE_SCHEMA,
    );
    const validation = validateAssessResponse(raw, allowed);
    if (!validation.ok) {
      console.warn(`[assess] rejected: ${validation.reason} (${Date.now() - t0}ms)`);
      res.status(502).json({ error: "validation_failed" });
      return;
    }
    console.log(`[assess] ok (${Date.now() - t0}ms)`);
    res.json(raw);
  } catch (err) {
    console.error(`[assess] error: ${(err as Error).message} (${Date.now() - t0}ms)`);
    res.status(502).json({ error: "generation_failed" });
  }
});

app.post("/api/summary", rateLimitGuard, async (req: Request, res: Response) => {
  const t0 = Date.now();
  try {
    const body = req.body as SummaryRequest;
    if (body.locale !== "en" || typeof body.suds_pre !== "number" || typeof body.suds_post !== "number") {
      res.status(400).json({ error: "malformed request" });
      return;
    }

    const allowed = allowedNumbersFrom(body.hr_start, body.hr_end);

    const raw = await generateJson(
      SUMMARY_SYSTEM_PROMPT,
      JSON.stringify(body),
      SUMMARY_RESPONSE_SCHEMA,
    );
    const validation = validateSummaryResponse(raw, allowed);
    if (!validation.ok) {
      console.warn(`[summary] rejected: ${validation.reason} (${Date.now() - t0}ms)`);
      res.status(502).json({ error: "validation_failed" });
      return;
    }
    console.log(`[summary] ok (${Date.now() - t0}ms)`);
    res.json(raw);
  } catch (err) {
    console.error(`[summary] error: ${(err as Error).message} (${Date.now() - t0}ms)`);
    res.status(502).json({ error: "generation_failed" });
  }
});

app.get("/healthz", (_req: Request, res: Response) => {
  res.status(200).send("ok");
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  console.log(`panicguard-server listening on :${port}`);
});
