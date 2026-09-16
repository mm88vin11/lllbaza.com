// Подставляет адрес обработчика заявок в исходник страницы и пересобирает
// index.html. Токенов здесь нет и быть не может — только публичный URL.
//
//   node build/set-lead.mjs https://lead.lllbaza.ru/
//   node build/set-lead.mjs --show
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'src/page.html');
const RE = /(LEAD = \{ endpoint: ')([^']*)(')/;

const src = readFileSync(file, 'utf8');
const found = src.match(RE);
if (!found) {
  console.error('не нашёл строку LEAD в src/page.html');
  process.exit(1);
}

const arg = process.argv[2];
if (!arg || arg === '--show') {
  console.log('текущий endpoint:', found[2] || '(не задан — заявки никуда не уходят)');
  process.exit(0);
}

let url;
try { url = new URL(arg); } catch { console.error('это не адрес:', arg); process.exit(1); }
if (url.protocol !== 'https:') { console.error('только https://'); process.exit(1); }

writeFileSync(file, src.replace(RE, (_, a, __, c) => a + url.href + c));
console.log('endpoint:', url.href);
console.log('теперь: node build/build.mjs');
