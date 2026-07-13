import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectCode = process.argv[2];
let srcDir = path.resolve(__dirname, '../../build/wasm');
// If not found in local package parent, check sibling SDK monorepo location
if (!fs.existsSync(srcDir)) {
  srcDir = path.resolve(__dirname, '../../../../wink-ai-embedded/build/wasm');
}
const destDir = projectCode 
  ? path.resolve(__dirname, '../public/wasm', projectCode)
  : path.resolve(__dirname, '../public/wasm');

const filesToCopy = ['wink_simulator.js', 'wink_simulator.wasm', 'wasm-app-id.txt'];

console.log(`Copying WASM simulation assets...`);
console.log(`Project Code: ${projectCode || 'None (root)'}`);
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
  } else if (file === 'wasm-app-id.txt') {
    // If it's the app id file and projectCode is provided, write it dynamically
    if (projectCode) {
      fs.writeFileSync(destPath, `${projectCode}\n`, 'utf8');
      console.log(`✓ Generated ${file} with value: ${projectCode}`);
    }
  } else {
    console.error(`✗ Source file not found: ${srcPath}`);
    success = false;
  }
}

if (!success) {
  console.warn('\n⚠️ Warning: Some WASM simulation assets are missing.');
  console.warn('Please build wasm first (from repo root or embedded-frontend):');
  console.warn('  python wink-micro-os/tools/wink.py build wasm --app wink-micro-app/oled_dashboard');
  console.warn('  # or: npm run wasm:build:oled\n');
} else {
  console.log(`✓ WASM simulation assets copied successfully!`);
  const appIdPath = path.join(destDir, 'wasm-app-id.txt');
  if (fs.existsSync(appIdPath)) {
    console.log(`Active wasm app id: ${fs.readFileSync(appIdPath, 'utf8').trim()}`);
  }
}
