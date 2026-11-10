'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

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

function loadGames() {
  fs.mkdirSync(iconsDir, { recursive: true });
  try {
    const parsed = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('bad format');
    games = parsed;
  } catch (e) {
    // Файла нет — это нормально (первый запуск). Файл битый — сохраняем копию.
    if (e.code !== 'ENOENT') {
      try { fs.copyFileSync(dbPath, dbPath + '.bak'); } catch { /* ignore */ }
    }
    games = [];
  }
}

function saveGames() {
  const tmp = dbPath + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(games, null, 2));
    fs.renameSync(tmp, dbPath);
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
function view(g) {
  return {
    id: g.id,
    name: g.name,
    exe_path: g.exe_path,
    icon: readImage(g.icon_file),
    has_banner: hasImage(g.banner_file),
    has_logo: hasImage(g.logo_file),
    hero: normalizeHero(g.hero),
    favorite: !!g.favorite,
    last_played: g.last_played ?? null,
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

function removeImage(name) {
  if (!name) return;
  try { fs.unlinkSync(path.join(iconsDir, name)); } catch { /* ignore */ }
}

/* images: { icon|banner|logo: { mode: 'keep' | 'set' | 'clear', path } }.
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
        const name = copyImage(spec.path, id, kind);
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
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

/* Как запускаем разные типы файлов:
   - exe, com: напрямую в папке игры; если Windows отказывает (например, нужны
     права администратора), через оболочку — она сама покажет окно UAC;
   - jar: через Java (javaw -jar); если Java нет в PATH, пробуем открыть так,
     как это делает Windows по двойному клику;
   - всё остальное (lnk, bat, cmd, url, msi…): через оболочку Windows. */
async function spawnGame(file) {
  const ext = extOf(file);
  const cwd = path.dirname(file);

  if (ext === 'jar') {
    try { await spawnProcess('javaw', ['-jar', file], cwd); return; } catch { /* нет javaw в PATH */ }
    try { await openViaShell(file); return; } catch { /* нет сопоставления с Java */ }
    throw new Error('Не удалось запустить .jar. Установите Java (JRE 8 или новее) и повторите.');
  }

  if (ext === 'exe' || ext === 'com') {
    try {
      await spawnProcess(file, [], cwd);
    } catch (e) {
      try { await openViaShell(file); } catch { throw e; }
    }
    return;
  }

  await openViaShell(file);
}

/* ---------- Команды для интерфейса ---------- */

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, args) => {
    try {
      return { data: await fn(args || {}) };
    } catch (e) {
      return { error: e && e.message ? e.message : String(e) };
    }
  });
}

function registerHandlers() {
  handle('get_version', () => app.getVersion());

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

  handle('add_game', ({ name, exePath, images, hero }) => {
    name = cleanName(name);
    checkExe(exePath, null);

    let id = Date.now();
    while (games.some((g) => g.id === String(id))) id += 1;
    id = String(id);

    // Картинки копируем в папку библиотеки, чтобы они не пропали,
    // если исходные файлы удалят или переместят.
    const { fields, created } = applyImages(null, images, id);
    const game = {
      id, name, exe_path: exePath, ...fields, hero: normalizeHero(hero),
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

  handle('update_game', ({ id, name, exePath, images, hero }) => {
    const old = findGame(id);
    name = cleanName(name);
    checkExe(exePath, id);

    const { fields, created, obsolete } = applyImages(old, images, id);
    const next = { ...old, name, exe_path: exePath, ...fields, hero: normalizeHero(hero) };
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
    try {
      await spawnGame(g.exe_path);
    } catch (e) {
      launchedAt.delete(id); // не запустилась, можно пробовать снова
      throw new Error(`Не удалось запустить игру: ${e.message}`);
    }
    g.last_played = Date.now();
    saveGames();
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
    try {
      fs.mkdirSync(iconsDir, { recursive: true });
      migrateOldLibrary();
      loadGames();
    } catch (e) {
      dialog.showErrorBox('ManyGameLib', `Не удалось открыть папку библиотеки:\n${dataDir}\n\n${e.message}`);
      app.quit();
      return;
    }
    registerHandlers();
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
