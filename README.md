# panicguard-web

Browser-based rPPG panic-support app. Measures heart rate from the front
camera (no wearable required) and guides the user through grounding and
resonance-breathing.

**Live demo:** https://panic-guard.ai.studio/

- `npm run dev` with no query params runs the actual app flow (intro →
  triage → measurement → grounding → breathing → summary).
- `?debug=1` runs a separate signal-processing debug harness (ROI overlay,
  live BVP waveform/spectrum, SQI readout, session recording) — useful for
  tuning the rPPG pipeline itself, not the end-user flow.

Not implemented yet: respiration-rate estimation, personal baseline HR, and
real-time HR-breathing biofeedback during the breathing screen (needs
IBI/RSA processing).

Gemini-generated RESULT/SUMMARY copy is implemented (`server/`, a thin
Cloud Run proxy) but **optional** — the client falls back to the static
English templates in `src/app/templates.ts` whenever `VITE_API_BASE_URL`
is unset, the backend is unreachable, or a response fails validation.
Grounding-step prompts are always static regardless of backend
configuration (Gemini calls are kept to a minimum by design: just the
RESULT and SUMMARY screens).

## Setup

```
npm install
npm run dev
```

`npm install` also fetches the face-tracking model/WASM runtime into
`public/models/` (see `scripts/setup-models.mjs`) — self-hosted rather than
loaded from jsdelivr/Google's CDN at runtime, since CDN latency to the
~3.7MB model file was unpredictable in testing and was eating directly into
the measurement time budget. If that step fails (e.g. no network during
install), re-run it with `npm run setup:models`.

## Gemini backend (optional)

`server/` is a small Express proxy that turns rule-engine output into
short supportive copy via Gemini, validates every response (banned words,
length limits, no ungrounded numbers — see `server/src/validate.ts`), and
rejects it wholesale on any failure so the client can fall back to its own
template. It never makes safety-routing or grade decisions itself; those
stay in `src/rules/ruleEngine.ts`.

### Local run (no deployment)

```
cd server
cp .env.example .env   # fill in GEMINI_API_KEY
npm install
npm run dev             # listens on :8080 by default
```

Then point the client at it for local testing:

```
# in the repo root, create .env.local
echo "VITE_API_BASE_URL=http://localhost:8080" >> .env.local
npm run dev
```

With no `.env.local` / `VITE_API_BASE_URL`, the client never attempts a
network call to the backend — this is the default and is what's been
tested most (see below).

### Deploying to Cloud Run

This environment has no `gcloud` CLI, so deployment hasn't been run or
verified here — these are the standard commands, to run yourself:

```
cd server
gcloud run deploy panicguard-server \
  --source . \
  --region <your-region> \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=<your-key>
```

`gcloud run deploy --source .` builds the `Dockerfile` in this directory
via Cloud Build automatically — no separate `docker build`/`push` step
needed. After it deploys, set `VITE_API_BASE_URL` to the printed service
URL (repo root `.env.production` or your hosting provider's env config)
and rebuild the client.

Consider also setting `ALLOWED_ORIGIN` (see `server/.env.example`) once
the client has a stable deployed origin, to replace the default permissive
CORS policy.


## Notes

- **HTTPS required for real devices**: `getUserMedia` needs a secure context.
  `localhost` works for desktop testing. To test on a physical phone over
  LAN, serve over HTTPS (e.g. `vite --host` plus a local TLS tunnel/mkcert) —
  plain HTTP over LAN will not be granted camera access.
- **iOS Safari**: the video element requires `playsinline muted autoplay`
  (already set). `requestVideoFrameCallback` support varies by iOS version;
  the app falls back to `requestAnimationFrame` + `performance.now()` when
  it's unavailable — this fallback path should be spot-checked on an actual
  older-iOS device, not just assumed to work.
- **ROI landmark indices** (`src/face/landmarkIndices.ts`) are a first-pass
  approximation and have not been pixel-verified against a live camera feed.
  Run with `?debug=1` and confirm the drawn forehead/cheek polygons actually
  track skin, not hairline/eyes/nostrils/mouth — adjust the index lists if
  they drift.
