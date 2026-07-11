/**
 * @file build-wasm.mjs
 * @brief 按 App 名驱动 CMake 构建 Wasm 目标，并将 wasm-app-id.txt 写入 public/wasm/。
 *
 * Usage:
 *   node scripts/build-wasm.mjs oled_dashboard
 *   node scripts/build-wasm.mjs avoidance_car
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const buildDir = path.join(repoRoot, 'build-wasm');
const microOsDir = process.env.WINK_SDK_PATH
  ? path.resolve(process.env.WINK_SDK_PATH)
  : path.join(repoRoot, 'wink-micro-os');

let app = process.argv[2] ?? 'oled_dashboard';
let appDir = '';

if (fs.existsSync(app) && fs.statSync(app).isDirectory()) {
  appDir = path.resolve(app);
  app = path.basename(appDir);
} else {
  const microAppDir = path.join(repoRoot, 'wink-micro-app');
  const microAppPath = path.join(microAppDir, app);
  if (fs.existsSync(microAppPath)) {
    appDir = microAppPath;
  } else {
    appDir = path.join(microOsDir, 'samples', app);
  }
}

if (!fs.existsSync(appDir)) {
  console.error(`[build-wasm] Unknown app sample directory: ${appDir}`);
  process.exit(1);
}

const codegenDir = process.env.WINK_CODEGEN_ROOT
  ? path.resolve(process.env.WINK_CODEGEN_ROOT)
  : path.join(repoRoot, 'tools/codegen');

// Step 1: emcmake cmake configure
const cmakeArgs = [
  '-S', microOsDir,
  '-B', buildDir,
  '-DTARGET_PLATFORM=wasm',
  `-DWINK_APP_DIR=${appDir}`,
  `-DWINK_CODEGEN_ROOT=${codegenDir}`,
];

console.log('[build-wasm]', 'emcmake cmake', cmakeArgs.join(' '));
let r = spawnSync('emcmake', ['cmake', ...cmakeArgs], { stdio: 'inherit', shell: true });
if (r.status !== 0) process.exit(r.status ?? 1);

// Step 2: cmake --build
r = spawnSync('cmake', ['--build', buildDir], { stdio: 'inherit', shell: true });
if (r.status !== 0) process.exit(r.status ?? 1);

// Step 3: Write wasm-app-id.txt for frontend indicator
const metaPath = path.join(repoRoot, 'embedded-frontend/public/wasm/wasm-app-id.txt');
fs.mkdirSync(path.dirname(metaPath), { recursive: true });
fs.writeFileSync(metaPath, `${app}\n`, 'utf8');
console.log(`[build-wasm] wrote ${metaPath}`);
console.log(`[build-wasm] ✓ Build complete for app: ${app}`);
