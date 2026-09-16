// Складывает всё, что уходит на хостинг, в одну папку dist/.
// Собирать руками нечего: node build/dist.mjs — и папку можно публиковать.
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (!existsSync(join(root, 'index.html'))) {
  console.error('нет index.html — сначала node build/build.mjs');
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'public'), dist, { recursive: true });
cpSync(join(root, 'index.html'), join(dist, 'index.html'));

let bytes = 0, files = 0;
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n); const st = statSync(p);
    if (st.isDirectory()) walk(p); else { bytes += st.size; files++; }
  }
};
walk(dist);
console.log(`dist/ готов — ${files} файлов, ${(bytes / 1048576).toFixed(2)} МБ`);
