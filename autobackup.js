'use strict';

/* Автоматические копии библиотеки в папку, которую выбрал пользователь (Настройки → Библиотека → Автокопии).
   Это тот же ZIP, что и при ручном экспорте (его собирает main.js), только по расписанию и с ограничением числа файлов.
   Модуль работает только с файлами вида ManyGameLib-auto-ГГГГ-ММ-ДД-ЧЧММ.zip: чужие файлы в той же папке не читаются и не удаляются. */

const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 3600 * 1000;
const NAME_RE = /^ManyGameLib-auto-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/;
const EVERY_DAYS = [1, 3, 7, 14, 30];
const KEEP_MIN = 1;
const KEEP_MAX = 30;

const pad = (n) => String(n).padStart(2, '0');

/* Имя по местному времени: так файлы в папке идут в порядке создания и понятны человеку. */
function nameFor(ts) {
  const d = new Date(ts);
  return `ManyGameLib-auto-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
}

/* Копии в папке, новые первыми. Нет папки или нет доступа: пустой список. */
function list(folder) {
  let names;
  try { names = fs.readdirSync(folder); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!NAME_RE.test(name)) continue;
    try {
      const st = fs.statSync(path.join(folder, name));
      if (st.isFile()) out.push({ name, mtime: st.mtimeMs, size: st.size });
    } catch { /* пропала между чтением папки и проверкой */ }
  }
  return out.sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : -1));
}

/* Пора ли делать копию: копий нет или самая свежая старше интервала. */
function due(files, everyDays, now = Date.now()) {
  if (!files.length) return true;
  return now - files[0].mtime >= everyDays * DAY_MS;
}

/* Пишет архив через временный файл. Возвращает полный путь. */
function write(folder, buf, now = Date.now()) {
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, nameFor(now));
  const tmp = `${target}.tmp`;
  try {
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
  return target;
}

/* Оставляет keep самых новых копий, остальные удаляет. Возвращает число удалённых. */
function rotate(folder, keep) {
  const files = list(folder);
  let removed = 0;
  for (const f of files.slice(Math.max(KEEP_MIN, keep))) {
    try { fs.unlinkSync(path.join(folder, f.name)); removed++; } catch { /* занят или нет прав: останется до следующего раза */ }
  }
  return removed;
}

module.exports = { nameFor, list, due, write, rotate, NAME_RE, EVERY_DAYS, KEEP_MIN, KEEP_MAX, DAY_MS };
