import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const publicDir = path.join(root, 'public');
const expected = [
  ['favicon-32x32.png', 32],
  ['apple-touch-icon.png', 180],
];

const [html, sidebar, svg] = await Promise.all([
  readFile(path.join(root, 'index.html'), 'utf8'),
  readFile(path.join(root, 'src/frontend/components/layout/Sidebar.tsx'), 'utf8'),
  readFile(path.join(publicDir, 'marketdesk-mark.svg'), 'utf8'),
]);

const requiredHtml = [
  'href="/marketdesk-mark.svg"',
  'href="/favicon-32x32.png"',
  'href="/apple-touch-icon.png"',
  'content="#5B55E7"',
];
for (const marker of requiredHtml) {
  if (!html.includes(marker)) throw new Error(`Missing brand metadata: ${marker}`);
}
if (html.includes('/vite.svg')) throw new Error('Vite favicon reference is still present');
if (!sidebar.includes('src="/marketdesk-mark.svg"')) {
  throw new Error('Sidebar does not use the canonical MarketDesk mark');
}
if (!svg.includes('viewBox="0 0 64 64"') || !svg.includes('#5B55E7')) {
  throw new Error('Canonical MarketDesk SVG geometry or palette is invalid');
}

for (const [filename, size] of expected) {
  const file = path.join(publicDir, filename);
  const [actual, rendered, metadata] = await Promise.all([
    readFile(file),
    sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer(),
    sharp(file).metadata(),
  ]);
  if (metadata.format !== 'png' || metadata.width !== size || metadata.height !== size) {
    throw new Error(`${filename} must be a ${size}x${size} PNG`);
  }
  if (!actual.equals(rendered)) {
    throw new Error(`${filename} is stale; run npm run generate:brand-assets`);
  }
}

console.log('MarketDesk brand assets and metadata verified.');
