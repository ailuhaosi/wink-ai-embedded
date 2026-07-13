import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const buildDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../build/wasm');

if (fs.existsSync(buildDir)) {
  fs.rmSync(buildDir, { recursive: true, force: true });
  console.log(`Removed ${buildDir}`);
} else {
  console.log(`Nothing to remove (${buildDir} does not exist)`);
}
