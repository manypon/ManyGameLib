'use strict';

/* Проверка и установка обновлений. Живёт в главном процессе, интерфейс видит только состояние.

   Два режима:
   - installer: приложение поставлено установщиком (рядом с exe лежит «Uninstall …exe»).
     Обновление скачивает и ставит electron-updater по данным latest.yml из GitHub Releases.
   - manual: портативная папка или запуск из исходников. Здесь только узнаём из GitHub API,
     что вышла новая версия, и открываем страницу релиза: самообновление папки без установщика ненадёжно. */

const fs = require('fs');
const path = require('path');

/* Сравнение версий вида 1.4.0 (суффиксы вроде -beta игнорируются): 1, 0 или -1. */
function cmpVersion(a, b) {
  const nums = (v) => String(v || '').replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const x = nums(a);
  const y = nums(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/* Сообщение об ошибке для интерфейса: electron-updater кладёт в него заголовки и стек, показывать их незачем. */
function shortError(e) {
  let m = String((e && e.message) || e || 'Неизвестная ошибка');
  if (/latest\.yml/.test(m) && /404/.test(m)) return 'В последнем релизе на GitHub нет файла latest.yml.';
  m = m.split('\n')[0].replace(/\s+/g, ' ').trim();
  return m.length > 200 ? `${m.slice(0, 197)}…` : m;
}

function createUpdater({ app, net, repoUrl, log, send }) {
  const m = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(repoUrl);
  const slug = m ? `${m[1]}/${m[2]}` : null;
  const exe = process.execPath;
  const installed = !!app.isPackaged && fs.existsSync(path.join(path.dirname(exe), `Uninstall ${path.basename(exe)}`));

  const state = {
    status: 'idle',          // idle | checking | none | available | downloading | ready | error
    mode: installed ? 'installer' : 'manual',
    current: app.getVersion(),
    version: null,           // найденная версия
    progress: 0,             // 0..100 при скачивании
    error: null,
  };

  function set(patch) {
    Object.assign(state, patch);
    try { send({ ...state }); } catch { /* окно могло закрыться */ }
  }

  let au = null;
  function getAu() {
    if (au) return au;
    au = require('electron-updater').autoUpdater;
    au.autoDownload = false;          // качаем только по кнопке
    au.autoInstallOnAppQuit = false;  // и ставим только по кнопке
    au.logger = null;
    au.on('update-available', (i) => { log('info', `обновление: доступна v${i.version}`); set({ status: 'available', version: i.version, error: null }); });
    au.on('update-not-available', () => set({ status: 'none', version: null, error: null }));
    au.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent || 0) }));
    au.on('update-downloaded', (i) => { log('info', `обновление: v${i.version} скачана`); set({ status: 'ready', version: i.version, progress: 100 }); });
    au.on('error', (e) => { log('error', `обновление: ${e && e.message}`); set({ status: 'error', error: shortError(e) }); });
    return au;
  }

  async function checkGithub() {
    if (!slug) throw new Error('Не удалось определить репозиторий.');
    const res = await net.fetch(`https://api.github.com/repos/${slug}/releases/latest`, {
      headers: { 'User-Agent': 'ManyGameLib', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`GitHub ответил: ${res.status}`);
    const tag = String((await res.json()).tag_name || '').replace(/^v/i, '');
    if (!/^\d+(\.\d+)*/.test(tag)) throw new Error('Не удалось прочитать версию последнего релиза.');
    if (cmpVersion(tag, state.current) > 0) {
      log('info', `обновление: на GitHub есть v${tag}`);
      set({ status: 'available', version: tag, error: null });
    } else {
      set({ status: 'none', version: null, error: null });
    }
  }

  async function check() {
    if (['checking', 'downloading', 'ready'].includes(state.status)) return { ...state };
    set({ status: 'checking', error: null });
    try {
      if (installed) await getAu().checkForUpdates();
      else await checkGithub();
      if (state.status === 'checking') set({ status: 'none' });
    } catch (e) {
      const msg = e && e.name === 'TimeoutError' ? 'GitHub не ответил вовремя.' : shortError(e);
      log('error', `обновление: проверка не удалась: ${msg}`);
      set({ status: 'error', error: msg });
    }
    return { ...state };
  }

  async function download() {
    if (!installed) throw new Error('Скачивание доступно только в установленной версии.');
    if (state.status !== 'available') throw new Error('Сначала проверьте обновления.');
    set({ status: 'downloading', progress: 0, error: null });
    getAu().downloadUpdate().catch((e) => {
      log('error', `обновление: скачивание не удалось: ${e && e.message}`);
      set({ status: 'error', error: shortError(e) });
    });
    return { ...state };
  }

  function install() {
    if (!installed || state.status !== 'ready') throw new Error('Обновление ещё не скачано.');
    log('info', `обновление: установка v${state.version}`);
    // тихая установка и запуск новой версии
    getAu().quitAndInstall(true, true);
  }

  return { check, download, install, getState: () => ({ ...state }), installed };
}

module.exports = { createUpdater, cmpVersion, shortError };
