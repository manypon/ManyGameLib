'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, net, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { createUpdater } = require('./updater');

const REPO_URL = 'https://github.com/manypon/ManyGameLib';
const LICENSE_NAME = 'MIT';

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'ico', 'bmp', 'gif'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  ico: 'image/x-icon', bmp: 'image/bmp', gif: 'image/gif',
};
const BAD_IMAGE = 'Неподдерживаемый формат картинки. Подойдут PNG, JPG, WEBP, ICO, BMP, GIF.';

/* Какие картинки бывают у игры и в каком поле games.json лежит имя файла. */
const IMAGE_FIELDS = { icon: 'icon_file', banner: 'banner_file', logo: 'logo_file' };

/* Настройки верхнего блока: фон (размытая обложка / свой баннер / цвет),
   показывать ли обложку справа и как её вписывать (обрезать / целиком). */
const HERO_BG = ['blur', 'banner', 'color'];
const HERO_FIT = ['cover', 'contain'];

let win = null;
let updater = null;
let dataDir, iconsDir, dbPath;
let games = [];

/* Повторный запуск одной и той же игры в течение этого времени игнорируем
   (на случай двойного нажатия). */
const LAUNCH_LOCK_MS = 3000;
const launchedAt = new Map(); // id игры -> когда её запустили

/* ---------- Хранилище ---------- */

/* Библиотека лежит в %USERPROFILE%\manypon\manygamelib (games.json и папка icons). */
function resolveDataDir() {
  return path.join(process.env.USERPROFILE || os.homedir(), 'manypon', 'manygamelib');
}

/* Если новой библиотеки ещё нет, но есть старая из версии GameLib
   (%APPDATA%\gamelib), копируем её, чтобы игры не пропали. Старую не удаляем. */
function migrateOldLibrary() {
  if (fs.existsSync(dbPath)) return;
  const appData = app.getPath('appData');
  for (const name of ['gamelib', 'GameLib']) {
    const old = path.join(appData, name);
    if (!fs.existsSync(path.join(old, 'games.json'))) continue;
    try {
      fs.copyFileSync(path.join(old, 'games.json'), dbPath);
      if (fs.existsSync(path.join(old, 'icons'))) {
        fs.cpSync(path.join(old, 'icons'), iconsDir, { recursive: true });
      }
    } catch { /* не вышло — начнём с пустой библиотеки */ }
    return;
  }
}

/* ---------- Чтение, резервные копии, восстановление ---------- */

const BACKUPS_KEEP = 5;           // сколько копий «по одной за запуск» хранить
const RETRY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE', 'EAGAIN', 'UNKNOWN']);
let backupsDir;
let libraryNotice = null;         // что показать пользователю после старта

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/* Файл на секунду занят антивирусом или облачной синхронизацией: пробуем ещё. */
function withRetry(fn, tries = 4, pause = 150) {
  for (let i = 1; ; i++) {
    try { return fn(); }
    catch (e) {
      if (i >= tries || !RETRY_CODES.has(e.code)) throw e;
      sleepSync(pause * i);
    }
  }
}

class CorruptError extends Error {}

/* Читает и проверяет файл. ENOENT пробрасывается как есть,
   «не читается» (занят, нет доступа) — тоже, «битый» — CorruptError. */
function readLibraryFile(file) {
  const text = withRetry(() => fs.readFileSync(file, 'utf8'));
  let parsed;
  try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new CorruptError('файл не читается как JSON'); }
  if (!Array.isArray(parsed)) throw new CorruptError('неверный формат');
  return parsed;
}

function listBackups() {
  try {
    return fs.readdirSync(backupsDir)
      .filter((n) => /^games-.*\.json$/.test(n))
      .sort().reverse()
      .map((n) => path.join(backupsDir, n));
  } catch { return []; }
}

/* Последняя рабочая копия: сначала .bak (прошлое сохранение), потом папка backups. */
function restoreFromBackup() {
  for (const file of [dbPath + '.bak', ...listBackups()]) {
    try { return { list: readLibraryFile(file), from: file }; } catch { /* пробуем следующую */ }
  }
  return null;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

/* Одна копия за запуск приложения, хранятся последние BACKUPS_KEEP. */
function makeStartupBackup() {
  if (!games.length) return;
  try {
    fs.mkdirSync(backupsDir, { recursive: true });
    fs.copyFileSync(dbPath, path.join(backupsDir, `games-${stamp()}.json`));
    for (const old of listBackups().slice(BACKUPS_KEEP)) {
      try { fs.unlinkSync(old); } catch { /* ignore */ }
    }
  } catch { /* копия не критична */ }
}

/* Загружает библиотеку. Бросает ошибку, если файл не удалось прочитать
   (занят, нет доступа): приложение тогда предложит повторить и не стартует с пустой. */
function loadGames() {
  fs.mkdirSync(iconsDir, { recursive: true });
  libraryNotice = null;
  try {
    games = readLibraryFile(dbPath);
    makeStartupBackup();
    return;
  } catch (e) {
    if (!(e instanceof CorruptError) && e.code !== 'ENOENT') throw e;
    if (e.code === 'ENOENT') {
      // Нет файла: первый запуск. Но если рядом есть копии, значит файл потеряли — вернём.
      const back = restoreFromBackup();
      if (!back) { games = []; return; }
      games = back.list;
      saveGames();
      libraryNotice = `Файл библиотеки не найден. Восстановлена последняя копия (${games.length} игр):\n${back.from}`;
      return;
    }
    // Файл есть, но битый: не затираем его, а откладываем в сторону.
    const kept = path.join(dataDir, `games.corrupt-${stamp()}.json`);
    try { fs.renameSync(dbPath, kept); } catch { /* ignore */ }
    const back = restoreFromBackup();
    if (back) {
      games = back.list;
      saveGames();
      libraryNotice = `Файл библиотеки был повреждён. Восстановлена последняя копия (${games.length} игр).\nПовреждённый файл сохранён здесь:\n${kept}`;
    } else {
      games = [];
      libraryNotice = `Файл библиотеки был повреждён, а копий не нашлось. Начата пустая библиотека.\nПовреждённый файл сохранён здесь:\n${kept}`;
    }
  }
}

function saveGames() {
  const tmp = dbPath + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(games, null, 2));
    // Прошлая версия остаётся как games.json.bak.
    if (fs.existsSync(dbPath)) { try { fs.copyFileSync(dbPath, dbPath + '.bak'); } catch { /* ignore */ } }
    withRetry(() => fs.renameSync(tmp, dbPath));
  } catch (e) {
    throw new Error(`Не удалось сохранить библиотеку: ${e.message}`);
  }
}

/* Заменяет список игр и сохраняет его на диск. Если запись не удалась,
   список в памяти возвращается как был, чтобы он не расходился с файлом. */
function commit(next) {
  const prev = games;
  games = next;
  try {
    saveGames();
  } catch (e) {
    games = prev;
    throw e;
  }
}

/* ---------- Настройки приложения ---------- */

/* Лежат отдельно от списка игр: %USERPROFILE%\manypon\manygamelib\settings.json.
   Неизвестные ключи при чтении отбрасываются, неверные значения заменяются
   на значения по умолчанию, поэтому битый или чужой файл настроек ничего не ломает. */
/* Фон приложения: свой слой за интерфейсом. default: картинка из папки ui/assets,
   custom: картинка пользователя (копия в icons), none: сплошной цвет.
   Фон «от игры» живёт только в верхнем блоке (настройки hero), а не здесь. */
const BG_MODES = ['none', 'default', 'custom'];
const SETTINGS_DEFAULTS = {
  background: { mode: 'default', blur: 4, dim: 40, file: null }, // blur в px, dim в %
  heroBackground: true,  // фон-карточка верхнего блока; выкл: текст лежит прямо на фоне приложения
  autostart: false,
  logging: false,
  javaPath: '',
  checkUpdates: true,    // проверять наличие новой версии при запуске
};
const toInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

let settingsPath;
let settings = normalizeSettings({});

function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const bg = r.background && typeof r.background === 'object' ? r.background : {};
  const d = SETTINGS_DEFAULTS;
  // только имя файла внутри icons, без путей
  const file = typeof bg.file === 'string' && bg.file && path.basename(bg.file) === bg.file ? bg.file : null;
  let mode = BG_MODES.includes(bg.mode) ? bg.mode : d.background.mode;
  if (mode === 'custom' && !file) mode = 'default'; // своей картинки нет: показываем стандартную
  return {
    background: {
      mode,
      blur: toInt(bg.blur, 0, 40, d.background.blur),
      dim: toInt(bg.dim, 0, 90, d.background.dim),
      file,
    },
    heroBackground: typeof r.heroBackground === 'boolean' ? r.heroBackground : d.heroBackground,
    autostart: typeof r.autostart === 'boolean' ? r.autostart : d.autostart,
    logging: typeof r.logging === 'boolean' ? r.logging : d.logging,
    checkUpdates: typeof r.checkUpdates === 'boolean' ? r.checkUpdates : d.checkUpdates,
    javaPath: typeof r.javaPath === 'string' ? r.javaPath.trim().slice(0, 500) : d.javaPath,
  };
}

function readSettingsFile(file) {
  const text = withRetry(() => fs.readFileSync(file, 'utf8'));
  let parsed;
  try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new CorruptError('файл не читается как JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new CorruptError('неверный формат');
  return parsed;
}

/* Настройки не критичны: что бы ни случилось, приложение стартует (с настройками по
   умолчанию). Битый файл откладываем в сторону, а не затираем; сначала пробуем .bak. */
function loadSettings() {
  try {
    settings = normalizeSettings(readSettingsFile(settingsPath));
    return;
  } catch (e) {
    if (e.code === 'ENOENT') { settings = normalizeSettings({}); return; }
    if (e instanceof CorruptError) {
      try { fs.renameSync(settingsPath, path.join(dataDir, `settings.corrupt-${stamp()}.json`)); } catch { /* ignore */ }
    }
  }
  try { settings = normalizeSettings(readSettingsFile(settingsPath + '.bak')); }
  catch { settings = normalizeSettings({}); }
}

function saveSettings(next) {
  const tmp = settingsPath + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    if (fs.existsSync(settingsPath)) { try { fs.copyFileSync(settingsPath, settingsPath + '.bak'); } catch { /* ignore */ } }
    withRetry(() => fs.renameSync(tmp, settingsPath));
  } catch (e) {
    throw new Error(`Не удалось сохранить настройки: ${e.message}`);
  }
  settings = next;
}

/* Применяет изменения поверх текущих. Менять можно только известные поля;
   имя файла фона (background.file) интерфейс напрямую не задаёт. */
function mergeSettings(patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const bg = p.background && typeof p.background === 'object' ? p.background : {};
  return normalizeSettings({
    ...settings,
    ...Object.fromEntries(['heroBackground', 'autostart', 'logging', 'javaPath', 'checkUpdates'].filter((k) => k in p).map((k) => [k, p[k]])),
    background: {
      ...settings.background,
      ...Object.fromEntries(['mode', 'blur', 'dim'].filter((k) => k in bg).map((k) => [k, bg[k]])),
    },
  });
}

/* ---------- Журнал и автозапуск ---------- */

const LOG_MAX_BYTES = 1024 * 1024; // дальше файл переименовывается в .old (хранится один)
let logsDir;

/* Пишет строку в logs\manygamelib.log. Ошибки записи молча игнорируются: журнал не должен ломать приложение. */
function writeLog(level, msg) {
  if (!logsDir) return;
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const file = path.join(logsDir, 'manygamelib.log');
    try { if (fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, file + '.old'); } catch { /* файла ещё нет */ }
    fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${msg}\n`);
  } catch { /* ignore */ }
}

/* Обычная запись: только если журнал включён в настройках. */
function logLine(level, msg) {
  if (settings.logging) writeLog(level, msg);
}

/* Автозапуск прописываем только в собранном приложении: в режиме разработки
   в автозапуск попал бы electron.exe, а не ManyGameLib. */
function applyAutostart(enabled) {
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: !!enabled }); }
  catch (e) { logLine('error', `автозапуск: ${e.message}`); }
}

/* Побочные эффекты после изменения настроек. */
function afterSettingsChange(prev, next) {
  if (next.autostart !== prev.autostart) applyAutostart(next.autostart);
  if (prev.logging && !next.logging) writeLog('info', 'журнал выключен');
  if (!prev.logging && next.logging) writeLog('info', 'журнал включён');
}

const extOf = (p) => path.extname(String(p || '')).slice(1).toLowerCase();
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const hasImage = (name) => !!name && isFile(path.join(iconsDir, name));

function dataUrl(file) {
  const ext = extOf(file);
  if (!IMAGE_EXTS.includes(ext)) throw new Error(BAD_IMAGE);
  let stat;
  try { stat = fs.statSync(file); } catch (e) { throw new Error(`Не удалось открыть картинку: ${e.message}`); }
  if (stat.size > MAX_IMAGE_BYTES) throw new Error('Файл картинки слишком большой (больше 8 МБ).');
  const buf = fs.readFileSync(file);
  return `data:${MIME[ext]};base64,${buf.toString('base64')}`;
}

function readImage(name) {
  if (!name) return null;
  try { return dataUrl(path.join(iconsDir, name)); } catch { return null; }
}

function normalizeHero(h) {
  h = h && typeof h === 'object' ? h : {};
  return {
    bg: HERO_BG.includes(h.bg) ? h.bg : 'blur',
    art: typeof h.art === 'boolean' ? h.art : true,
    fit: HERO_FIT.includes(h.fit) ? h.fit : 'cover',
  };
}

/* Игра для интерфейса. Тяжёлые картинки (баннер, логотип) не пересылаем
   со всем списком, интерфейс запрашивает их отдельно для выбранной игры. */
/* Время в игре: playtime_sec (секунды). Считаем, пока жив запущенный нами процесс игры.
   Запуски короче минуты не учитываем (игра вылетела сразу или запустился лаунчер и закрылся). */
const MIN_SESSION_SEC = 60;
const MAX_PLAYTIME_SEC = 100000 * 3600;

/* Время, заданное вручную: undefined/null/'' означает «не менять». */
function cleanPlaytime(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PLAYTIME_SEC) throw new Error('Время в игре задано неверно.');
  return Math.round(n);
}

function playtimeOf(g) {
  const n = Math.floor(Number(g && g.playtime_sec));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_PLAYTIME_SEC) : 0;
}

function view(g) {
  return {
    id: g.id,
    name: g.name,
    exe_path: g.exe_path,
    args: cleanArgs(g.args),
    icon: readImage(g.icon_file),
    has_banner: hasImage(g.banner_file),
    has_logo: hasImage(g.logo_file),
    hero: normalizeHero(g.hero),
    favorite: !!g.favorite,
    last_played: g.last_played ?? null,
    playtime_sec: playtimeOf(g),
    added_at: g.added_at,
    missing: !isFile(g.exe_path),
  };
}

function findGame(id) {
  const g = games.find((x) => x.id === id);
  if (!g) throw new Error('Игра не найдена в библиотеке.');
  return g;
}

/* Один и тот же файл может быть записан по-разному (регистр, слэши, ярлык на него).
   Приводим путь к ключу для сравнения. */
function pathKey(p) {
  let target = String(p || '');
  if (process.platform === 'win32' && extOf(target) === 'lnk') {
    try { target = shell.readShortcutLink(target).target || target; } catch { /* оставляем сам ярлык */ }
  }
  try { target = fs.realpathSync.native(target); } catch { /* файла может не быть */ }
  target = path.resolve(target);
  return process.platform === 'win32' ? target.toLowerCase() : target;
}

function cleanName(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('Введите название игры.');
  return name.slice(0, 80);
}

/* Параметры запуска: одна строка, без переносов и управляющих символов, не длиннее 1000 знаков. */
const MAX_ARGS_LEN = 1000;
const ARGS_TYPES = ['exe', 'com', 'jar']; // для остальных типов параметры не передаются (см. spawnGame)

function cleanArgs(args) {
  return String(args == null ? '' : args).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_ARGS_LEN);
}

/* Строка параметров в список: слова через пробел, в двойных кавычках пробелы сохраняются.
   Незакрытая кавычка захватывает остаток строки. Строка никогда не попадает в командную оболочку. */
function parseArgs(str) {
  const out = [];
  let cur = '';
  let inQuote = false;
  let has = false;
  for (const ch of String(str || '')) {
    if (ch === '"') { inQuote = !inQuote; has = true; continue; }
    if (!inQuote && /\s/.test(ch)) {
      if (has) { out.push(cur); cur = ''; has = false; }
      continue;
    }
    cur += ch;
    has = true;
  }
  if (has) out.push(cur);
  return out;
}

function checkExe(exePath, selfId) {
  if (!exePath || !isFile(exePath)) throw new Error('Файл игры не найден. Проверьте путь.');
  const key = pathKey(exePath);
  if (games.some((g) => g.id !== selfId && pathKey(g.exe_path) === key)) {
    throw new Error('Эта игра уже есть в библиотеке.');
  }
}

/* ---------- Картинки игры ---------- */

function copyImage(src, id, kind) {
  src = String(src || '');
  if (!IMAGE_EXTS.includes(extOf(src))) throw new Error(BAD_IMAGE);
  let stat;
  try { stat = fs.statSync(src); } catch (e) { throw new Error(`Не удалось открыть картинку: ${e.message}`); }
  if (!stat.isFile()) throw new Error('Не удалось открыть картинку: это не файл.');
  if (stat.size > MAX_IMAGE_BYTES) throw new Error('Файл картинки слишком большой (больше 8 МБ).');
  // Имя уникально, чтобы после замены картинки не подхватился старый кеш.
  const name = `${id}-${kind}-${Date.now().toString(36)}.${extOf(src)}`;
  try {
    fs.copyFileSync(src, path.join(iconsDir, name));
  } catch (e) {
    throw new Error(`Не удалось скопировать картинку: ${e.message}`);
  }
  return name;
}

/* Иконка самого файла (exe, lnk, url). Сначала просим у оболочки Windows крупную миниатюру (до 256 px),
   если не вышло, обычную иконку файла (около 32 px). Вернём PNG или null. */
const ICON_SIZE = 256;
const ICON_TYPES = ['exe', 'com', 'lnk', 'url'];

async function extractFileIcon(file) {
  try {
    const img = await nativeImage.createThumbnailFromPath(file, { width: ICON_SIZE, height: ICON_SIZE });
    if (img && !img.isEmpty()) return img.toPNG();
  } catch { /* на этой системе нет миниатюр или файл не подошёл */ }
  try {
    const img = await app.getFileIcon(file, { size: 'large' });
    if (img && !img.isEmpty()) return img.toPNG();
  } catch { /* ignore */ }
  return null;
}

function writeImageData(data, id, kind) {
  const name = `${id}-${kind}-${Date.now().toString(36)}.png`;
  try {
    fs.writeFileSync(path.join(iconsDir, name), data);
  } catch (e) {
    throw new Error(`Не удалось сохранить картинку: ${e.message}`);
  }
  return name;
}

/* Готовит images к applyImages. Принимаем из страницы только mode и path, данные картинки снаружи не берём.
   Режим icon.mode === 'exe' означает «взять иконку из файла игры»: достаём её здесь и подставляем как данные. */
async function prepareImages(images, exePath) {
  const out = {};
  for (const kind of Object.keys(IMAGE_FIELDS)) {
    const s = (images && images[kind]) || {};
    out[kind] = { mode: s.mode, path: s.path };
  }
  if (out.icon.mode === 'exe') {
    if (!ICON_TYPES.includes(extOf(exePath))) throw new Error('Для этого типа файла иконку получить нельзя.');
    const data = await extractFileIcon(exePath);
    if (!data) throw new Error('Не удалось получить иконку из файла.');
    out.icon = { mode: 'set', data };
  }
  return out;
}

function removeImage(name) {
  if (!name) return;
  try { fs.unlinkSync(path.join(iconsDir, name)); } catch { /* ignore */ }
}

/* images: { icon|banner|logo: { mode: 'keep' | 'set' | 'clear', path } } (после prepareImages у set может быть data вместо path).
   Возвращает новые поля файлов, список созданных (откатываем при ошибке)
   и список устаревших (удаляем после успешного сохранения). */
function applyImages(base, images, id) {
  const fields = {};
  const created = [];
  const obsolete = [];
  try {
    for (const [kind, field] of Object.entries(IMAGE_FIELDS)) {
      const spec = (images && images[kind]) || {};
      fields[field] = base ? (base[field] ?? null) : null;
      if (spec.mode === 'set') {
        const name = spec.data ? writeImageData(spec.data, id, kind) : copyImage(spec.path, id, kind);
        created.push(name);
        if (fields[field]) obsolete.push(fields[field]);
        fields[field] = name;
      } else if (spec.mode === 'clear') {
        if (fields[field]) obsolete.push(fields[field]);
        fields[field] = null;
      }
    }
  } catch (e) {
    created.forEach(removeImage);
    throw e;
  }
  return { fields, created, obsolete };
}

/* ---------- Запуск игры ---------- */

async function openViaShell(file) {
  const err = await shell.openPath(file);
  if (err) throw new Error(err);
}

function spawnProcess(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore' });
    } catch (e) {
      reject(e);
      return;
    }
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(child); });
  });
}

/* ---------- Поиск Java для .jar ---------- */

const JAVAW = 'javaw.exe';

/* Из строки реестра вида `"C:\...\javaw.exe" -jar "%1" %*` берём путь к javaw.
   Если .jar сопоставлен с архиватором, а не с Java, вернём null. */
function javawFromCommand(text) {
  const m = /"([^"]*javaw\.exe)"/i.exec(String(text || '')) || /^\s*(\S*javaw\.exe)\b/im.exec(String(text || ''));
  return m ? m[1] : null;
}

function regQuery(args) {
  return new Promise((resolve) => {
    execFile('reg', ['query', ...args], { windowsHide: true, timeout: 4000 },
      (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

/* Версия из имени папки: jdk-17.0.2 -> [17,0,2], jre1.8.0_300 -> [8,0,300] (старое «1.8» это Java 8). */
function javaVersionOf(name) {
  const nums = (String(name).match(/\d+/g) || []).map(Number);
  if (nums.length > 1 && nums[0] === 1) nums.shift();
  return nums;
}

function cmpJavaVersion(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

/* Ищет javaw.exe: PATH, JAVA_HOME, реестр, типичные папки Program Files.
   Окно архиватора больше не открываем: нет Java, так нет, говорим об этом прямо. */
async function findJavaw() {
  const found = (p) => (p && isFile(p) ? p : null);

  // 0. Путь, указанный в настройках: если он задан, ищем только его (неверный путь это ошибка, а не повод искать другую Java)
  if (settings.javaPath) {
    if (isFile(settings.javaPath)) return settings.javaPath;
    throw new Error(`Файл Java из настроек не найден: ${settings.javaPath}`);
  }

  // 1. PATH
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    const hit = dir && found(path.join(dir.replace(/^"|"$/g, ''), JAVAW));
    if (hit) return hit;
  }
  // 2. JAVA_HOME и JRE_HOME
  for (const key of ['JAVA_HOME', 'JRE_HOME']) {
    const home = process.env[key];
    const hit = home && found(path.join(home.replace(/^"|"$/g, ''), 'bin', JAVAW));
    if (hit) return hit;
  }
  // 3. Реестр Windows
  if (process.platform === 'win32') {
    const jar = javawFromCommand(await regQuery(['HKCR\\jarfile\\shell\\open\\command', '/ve']));
    if (found(jar)) return jar;
    for (const key of ['HKLM\\SOFTWARE\\JavaSoft', 'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft']) {
      const out = await regQuery([key, '/s', '/v', 'JavaHome']);
      for (const line of out.split(/\r?\n/)) {
        const m = /JavaHome\s+REG_SZ\s+(.+?)\s*$/i.exec(line);
        const hit = m && found(path.join(m[1], 'bin', JAVAW));
        if (hit) return hit;
      }
    }
  }
  // 4. Типичные папки установки (новые версии сверху)
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432]
    .filter(Boolean);
  const vendors = ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'BellSoft', 'Amazon Corretto', 'Semeru', 'Temurin'];
  for (const root of [...new Set(roots)]) {
    for (const vendor of vendors) {
      const base = path.join(root, vendor);
      let names;
      try { names = fs.readdirSync(base); } catch { continue; }
      names.sort((x, y) => cmpJavaVersion(javaVersionOf(y), javaVersionOf(x)));
      for (const name of names) {
        const hit = found(path.join(base, name, 'bin', JAVAW));
        if (hit) return hit;
      }
    }
  }
  return null;
}

/* Как запускаем разные типы файлов:
   - exe, com: напрямую в папке игры; если Windows отказывает (например, нужны
     права администратора), через оболочку — она сама покажет окно UAC (без параметров);
   - jar: через найденный javaw (-jar), без обращения к программе, назначенной в Windows;
   - всё остальное (lnk, bat, cmd, url, msi…): через оболочку Windows, без параметров.
   Параметры игры (args) передаются только для exe, com и jar, и всегда списком, не строкой для оболочки. */
/* Возвращает дочерний процесс (exe, com, jar) или null, если запуск прошёл через оболочку Windows. */
async function spawnGame(file, argsLine = '') {
  const ext = extOf(file);
  const argv = ARGS_TYPES.includes(ext) ? parseArgs(cleanArgs(argsLine)) : [];
  const cwd = path.dirname(file);

  if (ext === 'jar') {
    const javaw = await findJavaw();
    if (!javaw) {
      throw new Error('Java не найдена. Установите Java (JRE 8 или новее) или задайте переменную JAVA_HOME, затем повторите.');
    }
    logLine('info', `Java: ${javaw}`);
    try { return await spawnProcess(javaw, ['-jar', file, ...argv], cwd); }
    catch (e) { throw new Error(`Не удалось запустить Java (${javaw}): ${e.message}`); }
  }

  if (ext === 'exe' || ext === 'com') {
    try {
      return await spawnProcess(file, argv, cwd);
    } catch (e) {
      // Через оболочку (например, чтобы показать окно UAC) параметры передать нельзя.
      if (argv.length) {
        throw new Error(`${e.message}. Если игре нужны права администратора, запустите её без параметров или вручную.`);
      }
      try { await openViaShell(file); } catch { throw e; }
      return null;   // запущена через оболочку: процесса у нас нет, время не считаем
    }
  }

  await openViaShell(file);
  return null;
}

/* ---------- Время в игре ---------- */

const sessions = new Map(); // id игры -> { start }

function trackSession(id, child) {
  if (!child || sessions.has(id)) return;   // одна сессия на игру, второй экземпляр не удваивает время
  sessions.set(id, { start: Date.now() });
  child.once('exit', () => endSession(id));
}

function endSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  addPlaytime(id, Math.round((Date.now() - s.start) / 1000));
}

function addPlaytime(id, sec) {
  if (sec < MIN_SESSION_SEC) return;
  const g = games.find((x) => x.id === id);
  if (!g) return;   // игру успели убрать из библиотеки
  const prev = playtimeOf(g);
  g.playtime_sec = Math.min(prev + sec, MAX_PLAYTIME_SEC);
  try {
    saveGames();
  } catch (e) {
    g.playtime_sec = prev;
    logLine('error', `время в игре не сохранено: ${e.message}`);
    return;
  }
  logLine('info', `время: ${g.name} +${sec} с`);
  if (win && !win.isDestroyed()) win.webContents.send('game-updated', view(g));
}

/* ---------- Команды для интерфейса ---------- */

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, args) => {
    try {
      return { data: await fn(args || {}) };
    } catch (e) {
      const message = e && e.message ? e.message : String(e);
      logLine('error', `${channel}: ${message}`);
      return { error: message };
    }
  });
}

function registerHandlers() {
  handle('get_version', () => app.getVersion());

  /* Сведения для страницы «О приложении». */
  handle('get_app_info', () => ({
    version: app.getVersion(),
    dataDir,
    repo: REPO_URL,
    license: LICENSE_NAME,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    packaged: app.isPackaged,
  }));

  /* Обновления: состояние живёт в updater.js, интерфейс получает его командой и событием update-state. */
  handle('get_update_state', () => updater.getState());
  handle('check_update', () => updater.check());
  handle('download_update', () => updater.download());
  handle('install_update', () => { updater.install(); });

  /* Открывает папку данных, папку журнала или страницу проекта. Интерфейс передаёт только название цели,
     а не адрес или путь: произвольные ссылки и файлы отсюда открыть нельзя. */
  handle('open_external', async ({ target }) => {
    if (target === 'data') {
      const err = await shell.openPath(dataDir);
      if (err) throw new Error(`Не удалось открыть папку: ${err}`);
    } else if (target === 'logs') {
      fs.mkdirSync(logsDir, { recursive: true });
      const err = await shell.openPath(logsDir);
      if (err) throw new Error(`Не удалось открыть папку: ${err}`);
    } else if (target === 'repo') {
      await shell.openExternal(REPO_URL);
    } else if (target === 'release') {
      await shell.openExternal(`${REPO_URL}/releases/latest`);
    } else {
      throw new Error('Неизвестная цель.');
    }
  });

  /* Своя картинка для фона: копируем в папку библиотеки, включаем режим custom,
     старый файл удаляем только после успешного сохранения. */
  handle('set_wallpaper', ({ path: p }) => {
    const name = copyImage(p, 'app', 'wallpaper');
    const old = settings.background.file;
    try {
      saveSettings(normalizeSettings({ ...settings, background: { ...settings.background, mode: 'custom', file: name } }));
    } catch (e) {
      removeImage(name);
      throw e;
    }
    removeImage(old);
    return settings;
  });

  /* Убирает свою картинку; если она была включена, возвращается стандартный фон. */
  handle('clear_wallpaper', () => {
    const old = settings.background.file;
    saveSettings(normalizeSettings({ ...settings, background: { ...settings.background, file: null } }));
    removeImage(old);
    return settings;
  });

  handle('get_wallpaper', () => readImage(settings.background.file));

  handle('get_settings', () => settings);

  handle('save_settings', ({ patch }) => {
    const prev = settings;
    saveSettings(mergeSettings(patch));
    afterSettingsChange(prev, settings);
    return settings;
  });

  /* Возвращает настройки по умолчанию. Файл своего фона, если он был, удаляем. */
  handle('reset_settings', () => {
    const prev = settings;
    saveSettings(normalizeSettings({}));
    removeImage(prev.background.file);
    afterSettingsChange(prev, settings);
    logLine('info', 'настройки сброшены');
    return settings;
  });

  handle('get_games', () => games.map(view));

  /* Только id игр, файлы которых не найдены (дешёвая проверка при возврате в окно). */
  handle('get_missing', () => games.filter((g) => !isFile(g.exe_path)).map((g) => g.id));

  /* Тяжёлые картинки одной игры. */
  handle('get_assets', ({ id }) => {
    const g = findGame(id);
    return {
      icon: readImage(g.icon_file),
      banner: readImage(g.banner_file),
      logo: readImage(g.logo_file),
    };
  });

  /* Предпросмотр выбранного файла в форме (до сохранения). */
  handle('preview_image', ({ path: p }) => dataUrl(String(p || '')));

  /* Иконка файла для формы: data URL с PNG или null. */
  handle('file_icon', async ({ path: p }) => {
    p = String(p || '');
    if (!isFile(p) || !ICON_TYPES.includes(extOf(p))) return null;
    const data = await extractFileIcon(p);
    return data ? `data:image/png;base64,${data.toString('base64')}` : null;
  });

  handle('add_game', async ({ name, exePath, args, playtimeSec, images, hero }) => {
    const playtime = cleanPlaytime(playtimeSec);
    name = cleanName(name);
    checkExe(exePath, null);
    images = await prepareImages(images, exePath);

    let id = Date.now();
    while (games.some((g) => g.id === String(id))) id += 1;
    id = String(id);

    // Картинки копируем в папку библиотеки, чтобы они не пропали,
    // если исходные файлы удалят или переместят.
    const { fields, created } = applyImages(null, images, id);
    const game = {
      id, name, exe_path: exePath, args: cleanArgs(args), playtime_sec: playtime || 0, ...fields, hero: normalizeHero(hero),
      favorite: false, last_played: null, added_at: Date.now(),
    };
    try {
      commit([...games, game]);
    } catch (e) {
      created.forEach(removeImage);
      throw e;
    }
    return view(game);
  });

  handle('update_game', async ({ id, name, exePath, args, playtimeSec, images, hero }) => {
    const playtime = cleanPlaytime(playtimeSec);
    const old = findGame(id);
    name = cleanName(name);
    checkExe(exePath, id);
    images = await prepareImages(images, exePath);

    const { fields, created, obsolete } = applyImages(old, images, id);
    const next = { ...old, name, exe_path: exePath, args: cleanArgs(args), ...fields, hero: normalizeHero(hero) };
    if (playtime !== undefined) next.playtime_sec = playtime;   // не прислали: время остаётся как есть
    try {
      commit(games.map((g) => (g === old ? next : g)));
    } catch (e) {
      created.forEach(removeImage);
      throw e;
    }
    obsolete.forEach(removeImage);
    return view(next);
  });

  handle('launch_game', async ({ id }) => {
    const g = findGame(id);
    const last = launchedAt.get(id);
    if (last && Date.now() - last < LAUNCH_LOCK_MS) return view(g); // игра только что запущена
    if (!isFile(g.exe_path)) throw new Error(`Файл игры не найден: ${g.exe_path}`);
    launchedAt.set(id, Date.now()); // ставим сразу, чтобы второй запрос не прошёл, пока идёт первый
    let child = null;
    try {
      child = await spawnGame(g.exe_path, g.args);
    } catch (e) {
      launchedAt.delete(id); // не запустилась, можно пробовать снова
      throw new Error(`Не удалось запустить игру: ${e.message}`);
    }
    g.last_played = Date.now();
    saveGames();
    trackSession(id, child);
    logLine('info', `запуск: ${g.name} (${g.exe_path})${cleanArgs(g.args) && ARGS_TYPES.includes(extOf(g.exe_path)) ? ' [с параметрами]' : ''}`);
    return view(g);
  });

  handle('toggle_favorite', ({ id }) => {
    const g = findGame(id);
    g.favorite = !g.favorite;
    saveGames();
    return view(g);
  });

  /* Убирает игру из библиотеки. Файлы игры на диске не трогаем. */
  handle('remove_game', ({ id }) => {
    const g = findGame(id);
    games = games.filter((x) => x !== g);
    saveGames();
    Object.values(IMAGE_FIELDS).forEach((field) => removeImage(g[field]));
  });

  handle('pick_file', async ({ title, filters }) => {
    const res = await dialog.showOpenDialog(win, {
      title,
      filters: Array.isArray(filters) ? filters : undefined,
      properties: ['openFile'],
    });
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
  });

  handle('win_state', () => !!(win && win.isMaximized()));

  ipcMain.on('win', (event, action) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w) return;
    if (action === 'minimize') w.minimize();
    else if (action === 'toggleMaximize') (w.isMaximized() ? w.unmaximize() : w.maximize());
    else if (action === 'close') w.close();
  });
}

/* ---------- Окно ---------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    show: false,
    title: 'ManyGameLib',
    backgroundColor: '#0d0d12',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  // Страница не должна уходить на другие адреса и открывать новые окна: ссылки открывает только main.js.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.once('ready-to-show', () => win.show());

  // Интерфейс рисует свою кнопку «развернуть/восстановить», ему нужно знать состояние окна.
  const sendState = () => {
    if (win && !win.isDestroyed()) win.webContents.send('win-state', win.isMaximized());
  };
  win.on('maximize', sendState);
  win.on('unmaximize', sendState);

  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    dataDir = resolveDataDir();
    iconsDir = path.join(dataDir, 'icons');
    dbPath = path.join(dataDir, 'games.json');
    backupsDir = path.join(dataDir, 'backups');
    settingsPath = path.join(dataDir, 'settings.json');
    logsDir = path.join(dataDir, 'logs');
    // Не читается (занят, нет доступа)? Предлагаем повторить, с пустой библиотекой не стартуем.
    for (;;) {
      try {
        fs.mkdirSync(iconsDir, { recursive: true });
        migrateOldLibrary();
        loadGames();
        break;
      } catch (e) {
        const choice = dialog.showMessageBoxSync({
          type: 'error',
          title: 'ManyGameLib',
          message: 'Не удалось открыть библиотеку',
          detail: `${dbPath}\n\n${e.message}\n\nВозможно, файл занят другой программой. Ваши игры не потеряны.`,
          buttons: ['Повторить', 'Выйти'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        });
        if (choice !== 0) { app.quit(); return; }
      }
    }
    loadSettings();
    logLine('info', `запуск приложения v${app.getVersion()}, Electron ${process.versions.electron}, ${process.platform}`);
    if (libraryNotice) logLine('warn', libraryNotice.replace(/\n/g, ' '));
    // Приводим автозапуск в соответствие с настройкой (если его убрали или добавили снаружи).
    try {
      if (app.isPackaged && app.getLoginItemSettings().openAtLogin !== settings.autostart) applyAutostart(settings.autostart);
    } catch { /* ignore */ }
    updater = createUpdater({
      app, net, repoUrl: REPO_URL, log: logLine,
      send: (s) => { if (win && !win.isDestroyed()) win.webContents.send('update-state', s); },
    });
    registerHandlers();
    createWindow();
    // Тихая проверка через несколько секунд после запуска, если она не выключена в настройках.
    if (settings.checkUpdates) win.once('ready-to-show', () => setTimeout(() => updater.check(), 4000));
    if (libraryNotice) {
      win.once('ready-to-show', () => dialog.showMessageBox(win, { type: 'warning', title: 'ManyGameLib', message: 'Библиотека восстановлена', detail: libraryNotice, buttons: ['OK'], noLink: true }));
    }
  });

  // Игры продолжат работать после нашего выхода: время, прошедшее до него, сохраняем сейчас.
  app.on('before-quit', () => { for (const id of [...sessions.keys()]) endSession(id); });
  app.on('window-all-closed', () => app.quit());
}
