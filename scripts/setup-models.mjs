// Populates public/models/ so FaceLandmarker loads from this origin
// instead of jsdelivr/Google's CDN at runtime (see src/face/faceLandmarker.ts
// for why). Runs automatically on `npm install` (postinstall) and is safe
// to re-run — it skips anything already present.
import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const wasmSrcDir = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDestDir = join(root, "public/models/wasm");
const modelDest = join(root, "public/models/face_landmarker.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

function copyWasmFiles() {
  if (!existsSync(wasmSrcDir)) {
    console.warn(`[setup-models] ${wasmSrcDir} not found — run npm install first. Skipping WASM copy.`);
    return;
  }
  mkdirSync(wasmDestDir, { recursive: true });
  const files = readdirSync(wasmSrcDir).filter((f) => f.endsWith(".js") || f.endsWith(".wasm"));
  let copied = 0;
  for (const file of files) {
    const dest = join(wasmDestDir, file);
    if (existsSync(dest)) continue;
    copyFileSync(join(wasmSrcDir, file), dest);
    copied++;
  }
  console.log(`[setup-models] WASM runtime: ${copied} file(s) copied, ${files.length - copied} already present.`);
}

async function downloadModel() {
  if (existsSync(modelDest)) {
    console.log("[setup-models] face_landmarker.task already present, skipping download.");
    return;
  }
  console.log("[setup-models] Downloading face_landmarker.task (~3.7MB)...");
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    console.error(`[setup-models] Download failed: HTTP ${res.status}. The app will fail to load the face tracker until this succeeds — re-run "node scripts/setup-models.mjs".`);
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(modelDest), { recursive: true });
  await import("node:fs/promises").then((fs) => fs.writeFile(modelDest, buf));
  console.log(`[setup-models] Downloaded face_landmarker.task (${buf.length} bytes).`);
}

copyWasmFiles();
await downloadModel();
