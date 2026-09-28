import { ensureAppStylesInjected } from "./appStyles";
import { el, button } from "./dom";
import { APP_CONFIG } from "./appConfig";
import { MeasurementSession, type MeasurementMetrics } from "./measurementSession";
import {
  evaluateRules,
  type TriageInput,
  type Metrics,
  type RuleResult,
  type RedFlag,
} from "../rules/ruleEngine";
import {
  RESULT_TEMPLATES,
  ADVISORY_TEXT,
  SAFETY_COPY,
  DEFAULT_GROUNDING_STEPS,
  GROUNDING_ASSIST_TEXT,
  summaryCopy,
  PRIVACY_NOTE,
  type ResultCopy,
} from "./templates";
import { fetchAssessCopy, fetchSummaryCopy } from "./geminiClient";

type Screen =
  | "intro"
  | "arrival"
  | "triage"
  | "holding"
  | "assessing"
  | "result"
  | "safety"
  | "grounding"
  | "breathing"
  | "summary";

interface TriageAnswers {
  suds: number | null;
  recentExertion: boolean | null;
  flags: RedFlag[];
}

const FLAG_LABELS: { flag: RedFlag; label: string }[] = [
  { flag: "chest_pain_radiating", label: "Chest pain spreading to arm, jaw, or back" },
  { flag: "syncope", label: "Feeling like you might faint or lose consciousness" },
  { flag: "known_heart_disease", label: "You have a known heart condition" },
  { flag: "first_episode", label: "This is the first time this has happened" },
];

/**
 * Drives the production screen flow (spec §2). Independent from the
 * ?debug=1 harness in main.ts — owns its own MeasurementSession rather than
 * reusing the debug harness's camera wiring, since the two have very
 * different UI needs (hidden video + aggregate metrics here vs. visible
 * overlay + waveform/spectrum panels there).
 */
export class AppController {
  private root: HTMLElement;
  private screen: Screen = "intro";
  private triageStep = 0;
  private triage: TriageAnswers = { suds: null, recentExertion: null, flags: [] };
  private measurement = new MeasurementSession();
  private metrics: MeasurementMetrics | null = null;
  private ruleResult: RuleResult | null = null;
  private hrAtAssessment: number | null = null;
  private hrConfidenceAtAssessment: "high" | "low" = "low";
  private hrAtSummaryStart: number | null = null;
  private resultCopy: ResultCopy | null = null;
  private groundingIndex = 0;
  private breathingStartedAtMs = 0;
  private breathingPaceRpm: 6 | 8 = 6;
  private holdingPhraseIndex = 0;
  private timers: number[] = [];
  private unsubscribeMetrics: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  start(): void {
    ensureAppStylesInjected();
    this.render();
  }

  private clearTimers(): void {
    for (const t of this.timers) window.clearInterval(t);
    this.timers = [];
  }

  private goto(screen: Screen): void {
    this.clearTimers();
    this.screen = screen;
    this.render();
  }

  // ---------------------------------------------------------------- render

  private render(): void {
    this.root.innerHTML = "";
    const container = el("div", { class: "pg-app-root" });

    const topbar = el("div", { class: "pg-app-topbar" });
    if (
      this.screen !== "intro" &&
      this.screen !== "arrival" &&
      this.screen !== "safety" &&
      this.screen !== "breathing"
    ) {
      const link = el("a", { href: "#" }, ["Straight to breathing"]);
      link.addEventListener("click", (e) => {
        e.preventDefault();
        this.enterBreathing(6);
      });
      topbar.appendChild(link);
    }
    container.appendChild(topbar);

    const body = el("div", { class: "pg-app-body" });
    body.appendChild(this.renderScreen());
    container.appendChild(body);

    const bottombar = el("div", { class: "pg-app-bottombar" });
    if (this.screen !== "safety") {
      const link = el("a", { href: "#" }, ["Get help"]);
      link.addEventListener("click", (e) => {
        e.preventDefault();
        this.showHelpSheet();
      });
      bottombar.appendChild(link);
    }
    container.appendChild(bottombar);

    this.root.appendChild(container);
  }

  private renderScreen(): HTMLElement {
    switch (this.screen) {
      case "intro":
        return this.renderIntro();
      case "arrival":
        return this.renderArrival();
      case "triage":
        return this.renderTriage();
      case "holding":
        return this.renderHolding();
      case "assessing":
        return el("div", {}, [el("p", { class: "pg-line" }, ["Getting things ready..."])]);
      case "result":
        return this.renderResult();
      case "safety":
        return this.renderSafety();
      case "grounding":
        return this.renderGrounding();
      case "breathing":
        return this.renderBreathing();
      case "summary":
        return this.renderSummary();
    }
  }

  // ----------------------------------------------------------------- intro

  private renderIntro(): HTMLElement {
    const wrap = el("div");
    wrap.appendChild(el("p", { class: "pg-headline" }, ["Welcome to PanicGuard"]));
    wrap.appendChild(
      el("p", { class: "pg-line" }, [
        "Feeling like a panic attack might be coming? We're here to help.",
      ]),
    );
    wrap.appendChild(
      el("p", { class: "pg-line" }, [
        "A few quick questions, your heart rate from your camera, then grounding and breathing.",
      ]),
    );
    wrap.appendChild(button("Continue", "primary", () => this.goto("arrival")));
    return wrap;
  }

  // -------------------------------------------------------------- arrival

  private renderArrival(): HTMLElement {
    const wrap = el("div");
    wrap.appendChild(el("p", { class: "pg-headline" }, ["It's okay. I'm here."]));
    wrap.appendChild(el("p", { class: "pg-line" }, ["When you're ready, tap start and we'll go through this together."]));
    wrap.appendChild(button("Start", "primary", () => this.beginMeasurementAndTriage()));
    wrap.appendChild(el("p", { class: "pg-privacy-note" }, [PRIVACY_NOTE]));
    return wrap;
  }

  private async beginMeasurementAndTriage(): Promise<void> {
    this.goto("triage");
    const result = await this.measurement.start();
    if (result.ok) {
      this.unsubscribeMetrics = this.measurement.onUpdate((m) => {
        this.metrics = m;
        if (this.screen === "holding") this.checkHoldingReady();
      });
    }
  }

  // --------------------------------------------------------------- triage

  private renderTriage(): HTMLElement {
    const wrap = el("div");
    if (this.triageStep === 0) {
      wrap.appendChild(el("p", { class: "pg-headline" }, ["How distressed do you feel right now?"]));
      const labelRow = el("div", { class: "pg-suds-label" }, [
        el("span", {}, ["0 = okay"]),
        el("span", {}, ["10 = worst"]),
      ]);
      wrap.appendChild(labelRow);
      const grid = el("div", { class: "pg-suds-grid" });
      for (let i = 0; i <= 10; i++) {
        const b = el("button", { class: "pg-suds-btn", type: "button" }, [String(i)]);
        b.addEventListener("click", () => {
          this.triage.suds = i;
          this.triageStep = 1;
          this.render();
        });
        grid.appendChild(b);
      }
      wrap.appendChild(grid);
    } else if (this.triageStep === 1) {
      wrap.appendChild(
        el("p", { class: "pg-headline" }, ["Did you run or climb stairs in the last 5 minutes?"]),
      );
      const row = el("div", { class: "pg-flag-list" });
      const yes = el("button", { class: "pg-flag-btn", type: "button" }, ["Yes"]);
      yes.addEventListener("click", () => {
        this.triage.recentExertion = true;
        this.triageStep = 2;
        this.render();
      });
      const no = el("button", { class: "pg-flag-btn", type: "button" }, ["No"]);
      no.addEventListener("click", () => {
        this.triage.recentExertion = false;
        this.triageStep = 2;
        this.render();
      });
      row.appendChild(yes);
      row.appendChild(no);
      wrap.appendChild(row);
    } else {
      wrap.appendChild(el("p", { class: "pg-headline" }, ["Tap anything that applies"]));
      const list = el("div", { class: "pg-flag-list" });
      for (const { flag, label } of FLAG_LABELS) {
        const selected = this.triage.flags.includes(flag);
        const b = el(
          "button",
          { class: `pg-flag-btn${selected ? " pg-selected" : ""}`, type: "button" },
          [label],
        );
        b.addEventListener("click", () => {
          this.triage.flags = selected
            ? this.triage.flags.filter((f) => f !== flag)
            : [...this.triage.flags, flag];
          this.render();
        });
        list.appendChild(b);
      }
      wrap.appendChild(list);
      wrap.appendChild(button("Continue", "primary", () => this.submitTriage()));
    }
    return wrap;
  }

  private submitTriage(): void {
    const input: TriageInput = {
      suds: this.triage.suds ?? 5,
      recentExertion: this.triage.recentExertion ?? false,
      flags: this.triage.flags,
    };

    if (input.flags.includes("chest_pain_radiating") || input.flags.includes("syncope")) {
      this.finalizeAndRoute(input);
      return;
    }
    if (input.flags.includes("first_episode") && input.flags.includes("known_heart_disease")) {
      this.finalizeAndRoute(input);
      return;
    }

    const m = this.metrics;
    if (m && m.ready) {
      this.finalizeAndRoute(input);
    } else if (this.measurement.isCameraAvailable()) {
      this.pendingTriage = input;
      this.goto("holding");
    } else {
      this.finalizeAndRoute(input);
    }
  }

  private pendingTriage: TriageInput | null = null;

  // -------------------------------------------------------------- holding

  private renderHolding(): HTMLElement {
    const phrases = [
      "Feel your feet on the floor.",
      "Notice the weight of the phone in your hand.",
      "Let your shoulders drop a little.",
      "Feel your back against the chair.",
    ];
    const wrap = el("div");
    const faceOk = this.metrics?.faceDetected ?? false;
    wrap.appendChild(el("div", { class: `pg-indicator${faceOk ? " pg-face-ok" : ""}` }));
    wrap.appendChild(el("p", { class: "pg-headline" }, ["Measuring your heart rate"]));
    wrap.appendChild(
      el("p", { class: "pg-hint" }, [
        "Stay still and keep looking at the screen.",
      ]),
    );
    const cyclingLine = el("p", { class: "pg-line" }, [phrases[this.holdingPhraseIndex % phrases.length]]);
    wrap.appendChild(cyclingLine);

    const skipHolder = el("div");
    wrap.appendChild(skipHolder);

    this.timers.push(
      window.setInterval(() => {
        this.holdingPhraseIndex++;
        cyclingLine.textContent = phrases[this.holdingPhraseIndex % phrases.length];
      }, APP_CONFIG.holding.phraseCycleMs),
    );

    window.setTimeout(() => {
      if (this.screen !== "holding") return;
      const b = button("Continue without waiting", "secondary", () => this.finishHolding());
      skipHolder.appendChild(b);
      skipHolder.appendChild(
        el("p", { class: "pg-hint" }, ["You don't have to wait, but a little longer gives a more accurate reading."]),
      );
    }, APP_CONFIG.holding.showSkipButtonMs);

    return wrap;
  }

  private checkHoldingReady(): void {
    if (this.metrics?.ready || this.metrics?.forceFinished) this.finishHolding();
  }

  private finishHolding(): void {
    if (!this.pendingTriage) return;
    this.finalizeAndRoute(this.pendingTriage);
  }

  // ------------------------------------------------------- assess + result

  private finalizeAndRoute(triageInput: TriageInput): void {
    const m = this.metrics;
    const hrConfidence: "high" | "low" = m?.ready && m?.hrStable ? "high" : "low";
    this.hrAtAssessment = m?.hrBpm ?? null;
    this.hrConfidenceAtAssessment = hrConfidence;
    this.hrAtSummaryStart = this.hrAtAssessment;

    const metrics: Metrics = {
      hrBpm: this.hrAtAssessment,
      hrConfidence,
      rrRpm: null, // respiration-rate estimation is not implemented yet
      validSeconds: m?.validSeconds ?? 0,
    };

    this.goto("assessing");
    const result = evaluateRules(triageInput, metrics, null);
    this.ruleResult = result;
    this.resultCopy = null;

    // Minimum visible delay so the "Getting things ready..." screen doesn't
    // flash by unreadably fast when Gemini is unconfigured (instant null)
    // or answers very quickly. Gemini is skipped entirely on the safety
    // path — that copy is always static (spec: safety routing/copy is
    // never touched by the model).
    const minDelay = new Promise<void>((resolve) => window.setTimeout(resolve, 400));
    const assess = result.safety
      ? Promise.resolve(null)
      : fetchAssessCopy({
          suds: triageInput.suds,
          recentExertion: triageInput.recentExertion,
          flags: triageInput.flags,
          hrBpm: metrics.hrBpm,
          hrConfidence: metrics.hrConfidence,
          rrRpm: metrics.rrRpm,
          validSeconds: metrics.validSeconds,
          baselineHrBpm: null,
          grade: result.grade ?? "B",
          advisories: result.advisories,
          breathingStartRateRpm: result.breathingStartRateRpm,
        });

    Promise.all([minDelay, assess]).then(([, geminiCopy]) => {
      if (geminiCopy) this.resultCopy = { headline: geminiCopy.headline, lines: geminiCopy.lines };
      this.goto(result.safety ? "safety" : "result");
    });
  }

  private renderResult(): HTMLElement {
    const wrap = el("div");
    const grade = this.ruleResult?.grade ?? "B";
    const copy = this.resultCopy ?? RESULT_TEMPLATES[grade];
    wrap.appendChild(el("p", { class: "pg-headline" }, [copy.headline]));
    for (const line of copy.lines) wrap.appendChild(el("p", { class: "pg-line" }, [line]));

    if (this.hrAtAssessment !== null) {
      const hrLine =
        this.hrConfidenceAtAssessment === "high"
          ? `Heart rate measured about ${Math.round(this.hrAtAssessment)} per minute.`
          : "The heart-rate reading wasn't steady enough to trust.";
      wrap.appendChild(el("p", { class: "pg-line" }, [hrLine]));
    }

    for (const a of this.ruleResult?.advisories ?? []) {
      wrap.appendChild(el("p", { class: "pg-line" }, [ADVISORY_TEXT[a]]));
    }

    // Just one primary action here — the persistent top-right "Straight to
    // breathing" link already covers the skip-grounding option, so a second
    // button for the same thing was redundant.
    const primaryLabel = grade === "A" ? "Start breathing" : "Start";
    wrap.appendChild(
      button(primaryLabel, "primary", () => {
        if (grade === "A") this.enterBreathing(this.ruleResult?.breathingStartRateRpm ?? 6);
        else this.goto("grounding");
      }),
    );
    return wrap;
  }

  // -------------------------------------------------------------- safety

  private renderSafety(): HTMLElement {
    const wrap = el("div");
    wrap.appendChild(el("p", { class: "pg-headline" }, [SAFETY_COPY.headline]));
    wrap.appendChild(el("p", { class: "pg-line" }, [SAFETY_COPY.line]));
    const tel = el("a", { class: "pg-tel-link", href: "tel:911" }, [
      button("Call for help", "primary", () => {}),
    ]);
    wrap.appendChild(tel);
    wrap.appendChild(
      button(SAFETY_COPY.breathingWhileWaiting, "secondary", () => this.enterBreathing(6)),
    );
    return wrap;
  }

  // ----------------------------------------------------------- grounding

  private renderGrounding(): HTMLElement {
    const wrap = el("div");
    const step = DEFAULT_GROUNDING_STEPS[this.groundingIndex];
    wrap.appendChild(
      el("p", { class: "pg-grounding-count" }, [`${step.sense} · ${step.count}`]),
    );
    wrap.appendChild(el("p", { class: "pg-headline" }, [step.prompt]));
    wrap.appendChild(el("p", { class: "pg-line" }, [GROUNDING_ASSIST_TEXT]));
    const isLast = this.groundingIndex === DEFAULT_GROUNDING_STEPS.length - 1;
    wrap.appendChild(
      button(isLast ? "Done" : "Done, next", "primary", () => {
        if (isLast) this.enterBreathing(this.ruleResult?.breathingStartRateRpm ?? 6);
        else {
          this.groundingIndex++;
          this.render();
        }
      }),
    );
    return wrap;
  }

  // ----------------------------------------------------------- breathing

  private enterBreathing(paceRpm: 6 | 8): void {
    this.breathingPaceRpm = paceRpm;
    this.breathingStartedAtMs = performance.now();
    this.goto("breathing");
  }

  private renderBreathing(): HTMLElement {
    const wrap = el("div");
    const inhaleSec = this.breathingPaceRpm === 8 ? 3 : 4;
    const exhaleSec = this.breathingPaceRpm === 8 ? 4.5 : 6;
    const cycleMs = (inhaleSec + exhaleSec) * 1000;

    const ringWrap = el("div", { class: "pg-breathing-ring-wrap" });
    const ring = el("div", { class: "pg-breathing-ring" });
    const label = el("div", { class: "pg-breathing-label" }, ["Breathe in"]);
    // Paint at the small (exhaled) size with no transition first, so the
    // very first inhale has something to visibly grow FROM. Setting a
    // transition and the large size in the same synchronous pass as
    // creating the element gives the browser nothing to animate from — it
    // just renders already-large, which read as "starts at its biggest".
    ring.style.transform = "scale(0.6)";
    ringWrap.appendChild(ring);
    ringWrap.appendChild(label);
    wrap.appendChild(ringWrap);

    const finishHolder = el("div");
    wrap.appendChild(finishHolder);
    const finishBtn = button("Finish", "secondary", () => this.goto("summary"), true);
    const finishHint = el("p", { class: "pg-hint" }, [""]);
    finishHolder.appendChild(finishBtn);
    finishHolder.appendChild(finishHint);

    const applyPhase = () => {
      const elapsed = (performance.now() - this.breathingStartedAtMs) % cycleMs;
      const inhaling = elapsed < inhaleSec * 1000;
      label.textContent = inhaling ? "Breathe in" : "Breathe out";
      ring.style.transition = inhaling
        ? `transform ${inhaleSec}s ease-in-out`
        : `transform ${exhaleSec}s ease-in-out`;
      ring.style.transform = inhaling ? "scale(1.45)" : "scale(0.6)";
    };
    // Two rAFs (not one) reliably lands after the browser has painted the
    // scale(0.6) starting frame set above, in every engine — a single rAF
    // can still land in the same paint in some browsers.
    requestAnimationFrame(() => requestAnimationFrame(applyPhase));
    this.timers.push(window.setInterval(applyPhase, Math.min(inhaleSec, exhaleSec) * 1000));

    // Deliberately can't be rushed (spec §8.5) — but say so, otherwise a
    // disabled button with no explanation just looks broken.
    const enableFinishMs = APP_CONFIG.breathing.finishEnableMs;
    const updateFinishHint = () => {
      const remainingMs = this.breathingStartedAtMs + enableFinishMs - performance.now();
      if (remainingMs <= 0) {
        finishBtn.disabled = false;
        finishHint.textContent = "";
        return;
      }
      finishHint.textContent = `Finish in about ${Math.ceil(remainingMs / 1000)}s`;
    };
    updateFinishHint();
    this.timers.push(window.setInterval(updateFinishHint, 1000));

    return wrap;
  }

  // ------------------------------------------------------------- summary

  private renderSummary(): HTMLElement {
    const wrap = el("div");
    wrap.appendChild(el("p", { class: "pg-headline" }, ["How distressed do you feel now?"]));
    const grid = el("div", { class: "pg-suds-grid" });
    for (let i = 0; i <= 10; i++) {
      const b = el("button", { class: "pg-suds-btn", type: "button" }, [String(i)]);
      b.addEventListener("click", () => this.finishSummary(i));
      grid.appendChild(b);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  private finishSummary(sudsPost: number): void {
    const fallback = summaryCopy(sudsPost);
    const hrEnd = this.metrics?.hrBpm ?? null;
    const hrConfidence: "high" | "low" =
      this.metrics?.ready && this.metrics?.hrStable ? "high" : "low";
    const breathingSeconds = this.breathingStartedAtMs
      ? Math.round((performance.now() - this.breathingStartedAtMs) / 1000)
      : 0;

    this.root
      .querySelector(".pg-app-body")
      ?.replaceChildren(el("div", {}, [el("p", { class: "pg-line" }, ["Getting things ready..."])]));

    const minDelay = new Promise<void>((resolve) => window.setTimeout(resolve, 300));
    const fetchCopy = fetchSummaryCopy({
      sudsPre: this.triage.suds ?? 0,
      sudsPost,
      hrStart: this.hrAtSummaryStart,
      hrEnd,
      hrConfidence,
      breathingSeconds,
    });

    Promise.all([minDelay, fetchCopy]).then(([, geminiCopy]) => {
      const copy = geminiCopy ?? fallback;
      const wrap = el("div");
      wrap.appendChild(el("p", { class: "pg-headline" }, [copy.headline]));
      for (const line of copy.lines) wrap.appendChild(el("p", { class: "pg-line" }, [line]));
      if (this.hrAtSummaryStart !== null && hrEnd !== null) {
        wrap.appendChild(
          el("p", { class: "pg-line" }, [
            `Heart rate: started around ${Math.round(this.hrAtSummaryStart)}, now about ${Math.round(hrEnd)}.`,
          ]),
        );
      }
      wrap.appendChild(button("Breathe more", "primary", () => this.enterBreathing(this.breathingPaceRpm)));
      wrap.appendChild(button("Finish", "secondary", () => this.resetToArrival()));

      this.root.querySelector(".pg-app-body")?.replaceChildren(wrap);
    });
  }

  private resetToArrival(): void {
    this.unsubscribeMetrics?.();
    this.measurement.stop();
    this.measurement = new MeasurementSession();
    this.metrics = null;
    this.ruleResult = null;
    this.resultCopy = null;
    this.triage = { suds: null, recentExertion: null, flags: [] };
    this.triageStep = 0;
    this.groundingIndex = 0;
    this.goto("arrival");
  }

  // ---------------------------------------------------------------- help

  private showHelpSheet(): void {
    const overlay = el("div", {
      style:
        "position:fixed;inset:0;background:rgba(11,15,20,0.92);display:flex;align-items:center;justify-content:center;z-index:10;padding:20px;",
    });
    const card = el("div", {
      style: "background:#131b23;border-radius:16px;padding:24px;max-width:320px;width:100%;text-align:center;",
    });
    card.appendChild(el("p", { class: "pg-headline" }, ["Reach out for help"]));
    card.appendChild(el("a", { class: "pg-tel-link", href: "tel:911" }, [button("Emergency: 911", "primary", () => {})]));
    card.appendChild(el("a", { class: "pg-tel-link", href: "tel:988" }, [button("Crisis line: 988", "secondary", () => {})]));
    const close = button("Close", "link", () => overlay.remove());
    card.appendChild(close);
    overlay.appendChild(card);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    this.root.appendChild(overlay);
  }
}
