import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
const files = [
  'index.html', 'styles.css', 'core.js', 'app.js', 'pose-analysis.js',
  'pose-metrics.mjs', 'pose-3d.mjs', 'pose-engine.mjs', 'pose-compare.mjs', 'pose-phases.mjs', 'pose-labels.mjs'
];
const keyPattern = /sb_secret_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{15,}/;

const content = await Promise.all(files.map(async name => {
  let source = await readFile(new URL(name, root), 'utf8');
  if (keyPattern.test(source)) throw new Error('Possible credential in public asset: ' + name);
  if (name === 'index.html') {
    source = source.replace('대학 동아리 1개 · 로컬 프로토타입', '대학 동아리 1개 · 수업 공개판')
      .replace(/<footer>[\s\S]*?<\/footer>/, '<footer><span>TENNIS LAB / 대학 동아리 데모</span></footer>');
  }
  return source;
}));

await mkdir(output, { recursive: true });
if (!(await lstat(output)).isDirectory()) throw new Error('dist must be a real directory.');
for (const entry of await readdir(output, { withFileTypes: true })) {
  if (!entry.isFile() || !files.includes(entry.name)) {
    throw new Error('dist contains an unexpected entry. Use an empty dist directory and rebuild.');
  }
}
await Promise.all(files.map((name, i) => writeFile(new URL(name, output), content[i])));
console.log('Prepared ' + files.length + ' public assets in ' + fileURLToPath(output));
