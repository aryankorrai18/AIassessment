// Self-hosts the MediaPipe runtime + models under public/mediapipe, so the candidate app never
// depends on a third-party CDN (locked-down corporate networks often block it). Run once after `npm install`: npm run setup:mediapipe -w packages/candidate-frontend
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = join(dirname(createRequire(import.meta.url).resolve("@mediapipe/tasks-vision")), "wasm");
const wasmDst = join(root, "public/mediapipe/wasm");
const modelDst = join(root, "public/mediapipe/models");
mkdirSync(wasmDst, { recursive: true });
mkdirSync(modelDst, { recursive: true });

for (const f of readdirSync(wasmSrc)) copyFileSync(join(wasmSrc, f), join(wasmDst, f));
console.log(`Copied MediaPipe WASM runtime → ${wasmDst}`);

const MODELS = {
  "face_landmarker.task": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  "efficientdet_lite0.tflite": "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
};
for (const [name, url] of Object.entries(MODELS)) {
  const dst = join(modelDst, name);
  if (existsSync(dst)) {
    console.log(`${name} already present`);
    continue;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed for ${name}: HTTP ${res.status}`);
  writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
  console.log(`Downloaded ${name}`);
}
