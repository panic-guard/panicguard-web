import { DEFAULT_SIGNAL_CONFIG } from "../config/signalConfig";
import { SignalPipeline } from "./pipeline";
import type { ToWorker, FromWorker } from "./messages";

// Typed as `Worker` (the main-thread handle interface) rather than
// `DedicatedWorkerGlobalScope` to avoid mixing the DOM and WebWorker `lib`
// entries in one tsconfig (they declare conflicting globals). The runtime
// object is the same either way inside a module worker.
declare const self: Worker;

const pipeline = new SignalPipeline(DEFAULT_SIGNAL_CONFIG);
const TICK_MS = 1000;

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  switch (msg.type) {
    case "config":
      pipeline.setConfig(msg.config);
      break;
    case "samples":
      pipeline.ingest(msg.samples);
      break;
    case "reset":
      pipeline.reset();
      break;
  }
};

setInterval(() => {
  const result = pipeline.tick();
  if (result) {
    const message: FromWorker = { type: "result", payload: result };
    self.postMessage(message);
  }
}, TICK_MS);

const readyMessage: FromWorker = { type: "ready" };
self.postMessage(readyMessage);
