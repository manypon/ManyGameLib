'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ICON_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'ico', 'bmp', 'gif'];
const MAX_ICON_BYTES = 8 * 1024 * 1024;
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  ico: 'image/x-icon', bmp: 'image/bmp', gif: 'image/gif',
};
const BAD_ICON = 'Неподдерживаемый формат иконки. Подойдут PNG, JPG, WEBP, ICO, BMP, GIF.';

let win = null;
let dataDir, iconsDir, dbPath;
let games = [];

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

const extOf = (p) => path.extname(p).slice(1).toLowerCase();
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

function dataUrl(file) {
  const ext = extOf(file);
  if (!ICON_EXTS.includes(ext)) throw new Error(BAD_ICON);
  let stat;
  try { stat = fs.statSync(file); } catch (e) { throw new Error(`Не удалось открыть иконку: ${e.message}`); }
  if (stat.size > MAX_ICON_BYTES) throw new Error('Файл иконки слишком большой (больше 8 МБ).');
  const buf = fs.readFileSync(file);
  return `data:${MIME[ext]};base64,${buf.toString('base64')}`;
}

function view(g) {
  let icon = null;
  if (g.icon_file) {
    try { icon = dataUrl(path.join(iconsDir, g.icon_file)); } catch { /* иконки нет — будет заглушка */ }
  }
  return {
    id: g.id,
    name: g.name,
    exe_path: g.exe_path,
    icon,
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
  handle('get_games', () => games.map(view));

  handle('preview_icon', ({ path: p }) => dataUrl(String(p || '')));

  handle('add_game', ({ name, exePath, iconPath }) => {
    name = String(name || '').trim();
    if (!name) throw new Error('Введите название игры.');
    if (!exePath || !isFile(exePath)) throw new Error('Файл игры не найден. Проверьте путь.');
    if (games.some((g) => g.exe_path.toLowerCase() === exePath.toLowerCase())) {
      throw new Error('Эта игра уже есть в библиотеке.');
    }

    let id = Date.now();
    while (games.some((g) => g.id === String(id))) id += 1;
    id = String(id);

    // Копируем иконку в папку приложения, чтобы она не пропала,
    // если исходный файл удалят или переместят.
    let iconFile = null;
    if (iconPath && String(iconPath).trim()) {
      const ext = extOf(iconPath);
      if (!ICON_EXTS.includes(ext)) throw new Error(BAD_ICON);
      iconFile = `${id}.${ext}`;
      try {
        fs.copyFileSync(iconPath, path.join(iconsDir, iconFile));
      } catch (e) {
        throw new Error(`Не удалось скопировать иконку: ${e.message}`);
      }
    }

    const game = {
      id, name, exe_path: exePath, icon_file: iconFile,
      favorite: false, last_played: null, added_at: Date.now(),
    };
    games.push(game);
    saveGames();
    return view(game);
  });

  handle('launch_game', async ({ id }) => {
    const g = findGame(id);
    if (!isFile(g.exe_path)) throw new Error(`Файл игры не найден: ${g.exe_path}`);
    try {
      await spawnGame(g.exe_path);
    } catch (e) {
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
    if (g.icon_file) {
      try { fs.unlinkSync(path.join(iconsDir, g.icon_file)); } catch { /* ignore */ }
    }
  });

  handle('pick_file', async ({ title, filters }) => {
    const res = await dialog.showOpenDialog(win, {
      title,
      filters: Array.isArray(filters) ? filters : undefined,
      properties: ['openFile'],
    });
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
  });

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