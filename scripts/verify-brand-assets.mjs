import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const publicDir = path.join(root, 'public');
const expected = [
  { filename: 'favicon-32x32.png', size: 32, opaque: false },
  { filename: 'apple-touch-icon.png', size: 180, opaque: true },
];

const [html, sidebar, svg] = await Promise.all([
  readFile(path.join(root, 'index.html'), 'utf8'),
  readFile(path.join(root, 'src/frontend/components/layout/Sidebar.tsx'), 'utf8'),
  readFile(path.join(publicDir, 'marketdesk-mark.svg'), 'utf8'),
]);

const activeHtml = html.replace(/<!--[\s\S]*?-->/g, '');
const htmlTags = (name) =>
  [...activeHtml.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map((match) => {
    const attributes = new Map();
    for (const attribute of match[1].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) {
      attributes.set(attribute[1].toLowerCase(), attribute[3]);
    }
    return attributes;
  });
const links = htmlTags('link');
const requiredLinks = [
  ['icon', '/marketdesk-mark.svg'],
  ['icon', '/favicon-32x32.png'],
  ['apple-touch-icon', '/apple-touch-icon.png'],
];
for (const [rel, href] of requiredLinks) {
  if (!links.some((attributes) => attributes.get('rel') === rel && attributes.get('href') === href)) {
    throw new Error(`Missing active brand link: rel=${rel} href=${href}`);
  }
}
if (activeHtml.includes('/vite.svg')) throw new Error('Vite favicon reference is still present');
if (
  !htmlTags('meta').some(
    (attributes) =>
      attributes.get('name') === 'theme-color' && attributes.get('content') === '#5B55E7',
  )
) {
  throw new Error('Missing active MarketDesk theme-color metadata');
}

const activeSidebar = sidebar
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const canonicalSidebarMark = [...activeSidebar.matchAll(/<Box\b([\s\S]*?)\/>/g)].some((match) => {
  const attributes = new Map();
  for (const attribute of match[1].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) {
    attributes.set(attribute[1], attribute[3]);
  }
  return (
    attributes.get('component') === 'img' &&
    attributes.get('src') === '/marketdesk-mark.svg' &&
    attributes.get('alt') === '' &&
    attributes.get('aria-hidden') === 'true'
  );
});
if (!canonicalSidebarMark) {
  throw new Error('Sidebar does not use the canonical MarketDesk mark');
}

const forbiddenSvg = /<!--|<!|<\s*(?:script|foreignObject|style|image|use|a|animate)\b|\b(?:href|on[a-z]+)\s*=|url\s*\(/i;
if (forbiddenSvg.test(svg)) throw new Error('Canonical MarketDesk SVG contains unsafe content');
await sharp(Buffer.from(svg)).metadata();
const allowedSvgTags = new Set(['svg', 'title', 'circle', 'path']);
const svgTags = [...svg.matchAll(/<\/?\s*([a-z][\w:-]*)\b/gi)].map((match) => match[1]);
if (svgTags.length === 0 || svgTags.some((tag) => !allowedSvgTags.has(tag))) {
  throw new Error('Canonical MarketDesk SVG contains an unexpected element');
}
if (!svg.includes('viewBox="0 0 64 64"') || !svg.includes('#5B55E7')) {
  throw new Error('Canonical MarketDesk SVG geometry or palette is invalid');
}

for (const { filename, size, opaque } of expected) {
  const file = path.join(publicDir, filename);
  let renderer = sharp(Buffer.from(svg)).resize(size, size);
  if (opaque) renderer = renderer.flatten({ background: '#5B55E7' });
  const [actual, rendered, metadata] = await Promise.all([
    readFile(file),
    renderer.png({ compressionLevel: 9 }).toBuffer(),
    sharp(file).metadata(),
  ]);
  if (metadata.format !== 'png' || metadata.width !== size || metadata.height !== size) {
    throw new Error(`${filename} must be a ${size}x${size} PNG`);
  }
  if (!actual.equals(rendered)) {
    throw new Error(`${filename} is stale; run npm run generate:brand-assets`);
  }
  if (opaque && metadata.hasAlpha) {
    throw new Error(`${filename} must have a full-bleed opaque background`);
  }
}

console.log('MarketDesk brand assets and metadata verified.');
