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

const destDirs = [];
if (projectCode) {
  destDirs.push(path.resolve(__dirname, '../public/wasm', projectCode));
} else {
  // Root fallback only
  destDirs.push(path.resolve(__dirname, '../public/wasm'));
}

const filesToCopy = ['wink_simulator.js', 'wink_simulator.wasm', 'wasm-app-id.txt'];

console.log(`Copying WASM simulation assets...`);
console.log(`Project Code: ${projectCode || 'None (root)'}`);
console.log(`Source: ${srcDir}`);
console.log(`Destinations: ${destDirs.map(d => path.basename(d)).join(', ')}`);

let success = true;

for (const destDir of destDirs) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const isRoot = destDir === path.resolve(__dirname, '../public/wasm');
  const targetCode = isRoot ? null : path.basename(destDir);

  for (const file of filesToCopy) {
    const srcPath = path.join(srcDir, file);
    const destPath = path.join(destDir, file);
    
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      // For default template directories, ensure wasm-app-id.txt contains the specific app name
      if (file === 'wasm-app-id.txt' && targetCode) {
        fs.writeFileSync(destPath, `${targetCode}\n`, 'utf8');
      }
    } else if (file === 'wasm-app-id.txt') {
      if (targetCode) {
        fs.writeFileSync(destPath, `${targetCode}\n`, 'utf8');
      }
    } else {
      console.error(`✗ Source file not found: ${srcPath}`);
      success = false;
    }
  }
}

if (!success) {
  console.warn('\n⚠️ Warning: Some WASM simulation assets are missing.');
  console.warn('Please build wasm first (from repo root or embedded-frontend):');
  console.warn('  python wink-micro-os/tools/wink.py build wasm --app wink-micro-app/oled_dashboard');
  console.warn('  # or: npm run wasm:build:oled\n');
} else {
  console.log(`✓ WASM simulation assets copied successfully!`);
}
