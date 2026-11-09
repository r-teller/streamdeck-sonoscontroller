import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const manifestPath = path.join(__dirname, '..', 'public', 'manifest.json');

const manifestContent = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestContent);

const version = manifest.Version || '0.0.0.0';
const segments = version.split('.');
const buildIndex = 3;

// Ensure at least 4 segments, fill missing with 0
while (segments.length < 4) {
  segments.push('0');
}

const oldVersion = segments.join('.');
segments[buildIndex] = String(parseInt(segments[buildIndex], 10) + 1);
const newVersion = segments.join('.');

manifest.Version = newVersion;

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`Version bumped: ${oldVersion} → ${newVersion}`);
