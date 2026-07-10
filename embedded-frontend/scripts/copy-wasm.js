import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.resolve(__dirname, '../../build-wasm');
const destDir = path.resolve(__dirname, '../public/wasm');

const filesToCopy = ['wink_simulator.js', 'wink_simulator.wasm'];

console.log(`Copying WASM simulation assets...`);
console.log(`Source: ${srcDir}`);
console.log(`Destination: ${destDir}`);

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

let success = true;
for (const file of filesToCopy) {
  const srcPath = path.join(srcDir, file);
  const destPath = path.join(destDir, file);
  
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`✓ Copied ${file}`);
  } else {
    console.error(`✗ Source file not found: ${srcPath}`);
    success = false;
  }
}

if (!success) {
  console.warn('\n⚠️ Warning: Some WASM simulation assets are missing.');
  console.warn('Please run the WASM CMake build first in the repo root:');
  console.warn('  cmake --build build-wasm\n');
} else {
  console.log(`✓ WASM simulation assets copied successfully!`);
  const appIdPath = path.join(destDir, 'wasm-app-id.txt');
  if (fs.existsSync(appIdPath)) {
    console.log(`Active wasm app id: ${fs.readFileSync(appIdPath, 'utf8').trim()}`);
  }
}
