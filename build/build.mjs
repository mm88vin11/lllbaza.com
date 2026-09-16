// Сборка страницы. Два режима, и разница между ними только в том, где лежат
// кадры заставки и картинки ленты.
//
//   node build/build.mjs            — прод: медиа отдельными файлами в dist/
//   node build/build.mjs --inline   — один файл: всё встроено в index.html
//
// Почему по умолчанию не «один файл». Кадров 266, это ~15 МБ. В base64 они
// весят на треть больше и лежат внутри документа — значит браузер обязан
// выкачать их целиком прежде, чем покажет первый экран. На телефоне это
// десятки секунд. Отдельными файлами те же кадры грузятся параллельно, в том
// порядке, который задаёт сам компонент, кешируются по отдельности и не
// задерживают отрисовку. Режим --inline остаётся для случая «скинуть один
// файл»: открывается с диска, без сервера.
import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync, readdirSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const inline = process.argv.includes('--inline');

const page = readFileSync(join(root, 'src/page.html'), 'utf8');
const runtime = readFileSync(join(root, 'src/assets/runtime.json'), 'utf8');
// Медиа лежит настоящими файлами: так его видно в диффе, оно не раздувается
// на треть от base64 и его можно открыть глазами, не разбирая JSON.
const MEDIA_DIR = join(root, 'src/assets/media');
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' };
const listMedia = (dir = MEDIA_DIR, prefix = '') => {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? prefix + '/' + name.name : name.name;
    if (name.isDirectory()) out.push(...listMedia(join(dir, name.name), rel));
    else out.push(rel);
  }
  return out;
};
const mediaKeys = listMedia();

for (const mark of ['/*__LB_RUNTIME_RESOURCES__*/', '/*__LB_MEDIA_RESOURCES__*/']) {
  if (!page.includes(mark)) throw new Error('в src/page.html нет метки ' + mark);
}

// Копии React встроены всегда: без них не поднимется вообще ничего, и
// отдельный запрос за ними — это лишний круг до первого кадра.
let mediaLiteral;
if (inline) {
  const bag = {};
  for (const key of mediaKeys) {
    const ext = key.slice(key.lastIndexOf('.'));
    const type = MIME[ext];
    if (!type) throw new Error('неизвестный тип медиа: ' + key);
    bag[key] = 'data:' + type + ';base64,' + readFileSync(join(MEDIA_DIR, key)).toString('base64');
  }
  mediaLiteral = JSON.stringify(bag);
} else {
  // Раскладываем медиа по настоящим путям. Компонент просит их теми же
  // ключами ('seqd/f000.webp'), а rsrc() без записи в __resources отдаёт
  // ключ как относительный адрес — код менять не нужно.
  const out = join(root, 'public/media');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(MEDIA_DIR, out, { recursive: true });
  const bytes = mediaKeys.reduce((n, k) => n + statSync(join(MEDIA_DIR, k)).size, 0);
  console.log(`медиа: ${mediaKeys.length} файлов, ${(bytes / 1048576).toFixed(2)} МБ → public/media/`);
  mediaLiteral = '{}';
}

let out = page
  .replace('/*__LB_RUNTIME_RESOURCES__*/', () => runtime)
  .replace('/*__LB_MEDIA_RESOURCES__*/', () => mediaLiteral);

// В прод-режиме кадры лежат в /media/, а просит их компонент по чистому
// ключу. Одна строка базового пути — и оба режима работают одним кодом.
out = out.replace('/*__LB_MEDIA_BASE__*/', inline ? '' : '/media/');

const dest = join(root, 'index.html');
writeFileSync(dest, out);
console.log(`index.html собран${inline ? ' (один файл)' : ''} — ${(statSync(dest).size / 1048576).toFixed(2)} МБ`);
