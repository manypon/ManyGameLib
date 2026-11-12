'use strict';

/* Поиск обложек в SteamGridDB (https://www.steamgriddb.com). Живёт в главном процессе:
   страница не видит ни ключ, ни сеть, а получает только списки и уже скачанные картинки.

   Ключ API каждый пользователь получает сам (профиль на steamgriddb.com, «Preferences → API»).
   Хранится отдельно от настроек, в secrets.json, зашифрованным средствами Windows (safeStorage).
   В страницу, в журнал и в экспорт библиотеки он не попадает. */

const fs = require('fs');
const os = require('os');
const path = require('path');

const API = 'https://www.steamgriddb.com/api/v2';
const MAX_BYTES = 8 * 1024 * 1024;   // как для остальных картинок
const KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;
const MIMES = 'image/png,image/jpeg,image/webp';

/* Вид картинки в форме -> раздел API и фильтры. nsfw и humor выключены всегда. */
const KINDS = {
  cover: { section: 'grids', query: `dimensions=600x900,342x482,660x930&mimes=${MIMES}` },
  banner: { section: 'heroes', query: `mimes=${MIMES}` },
  logo: { section: 'logos', query: 'mimes=image/png,image/webp' },
  icon: { section: 'icons', query: 'mimes=image/png,image/webp' },
};

/* Что за картинка, определяем по первым байтам, а не по заголовку сервера. */
function sniff(buf) {
  if (buf.length > 12 && buf.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 6 && buf.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  return null;
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

/* Только https и только сам SteamGridDB (и его CDN): ничего чужого страница скачать не заставит. */
function allowedUrl(u) {
  let x;
  try { x = new URL(String(u)); } catch { return null; }
  if (x.protocol !== 'https:') return null;
  const host = x.hostname.toLowerCase();
  if (host !== 'steamgriddb.com' && !host.endsWith('.steamgriddb.com')) return null;
  return x;
}

function createSgdb({ net, safeStorage, file, tmpDir = path.join(os.tmpdir(), 'manygamelib-sgdb'), log = () => {} }) {
  /* ---------- ключ ---------- */

  function readKey() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!raw || typeof raw.sgdbKey !== 'string') return null;
      const key = safeStorage.decryptString(Buffer.from(raw.sgdbKey, 'base64'));
      return KEY_RE.test(key) ? key : null;
    } catch { return null; }
  }

  function writeKey(key) {
    const body = JSON.stringify({ v: 1, sgdbKey: safeStorage.encryptString(key).toString('base64') });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, file);
  }

  const hasKey = () => !!readKey();

  /* ---------- запросы ---------- */

  async function request(url, key, { asJson = true } = {}) {
    let res;
    try {
      res = await net.fetch(url, {
        headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'ManyGameLib', Accept: asJson ? 'application/json' : 'image/*' },
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
    } catch (e) {
      if (e && e.name === 'TimeoutError') throw new Error('SteamGridDB не ответил вовремя.');
      throw new Error('Не удалось связаться с SteamGridDB.');
    }
    if (res.status === 401 || res.status === 403) { const e = new Error('SteamGridDB не принял ключ. Проверьте его в настройках.'); e.code = 'BAD_KEY'; throw e; }
    if (res.status === 429) throw new Error('SteamGridDB просит подождать: слишком много запросов.');
    if (res.status === 404) return asJson ? { success: true, data: [] } : res;
    if (!res.ok) throw new Error(`SteamGridDB ответил: ${res.status}`);
    return res;
  }

  async function api(pathAndQuery) {
    const key = readKey();
    if (!key) { const e = new Error('Сначала укажите API-ключ SteamGridDB.'); e.code = 'NO_KEY'; throw e; }
    const res = await request(`${API}${pathAndQuery}`, key);
    const body = res.json ? await res.json() : res;
    if (!body || body.success === false) throw new Error((body && body.errors && body.errors[0]) || 'SteamGridDB вернул ошибку.');
    return Array.isArray(body.data) ? body.data : [];
  }

  /* Ключ проверяем пробным запросом. Неверный ключ не сохраняем; если сети нет, сохраняем и честно говорим, что не проверили. */
  async function setKey(raw) {
    const key = String(raw || '').trim();
    if (!KEY_RE.test(key)) throw new Error('Ключ выглядит неверно: это буквы и цифры, обычно 32 знака.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Шифрование Windows недоступно, ключ сохранить нельзя.');
    let verified = true;
    try {
      await request(`${API}/search/autocomplete/test`, key);
    } catch (e) {
      if (e.code === 'BAD_KEY') throw e;
      verified = false;
    }
    writeKey(key);
    log('info', `SteamGridDB: ключ сохранён${verified ? '' : ' (проверить не удалось)'}`);
    return { hasKey: true, verified };
  }

  function clearKey() {
    try { fs.unlinkSync(file); } catch { /* ключа и не было */ }
    log('info', 'SteamGridDB: ключ удалён');
    return { hasKey: false };
  }

  /* ---------- поиск и картинки ---------- */

  async function search(term) {
    const t = String(term || '').trim().slice(0, 100);
    if (!t) return [];
    const list = await api(`/search/autocomplete/${encodeURIComponent(t)}`);
    return list
      .filter((g) => g && Number.isInteger(g.id) && typeof g.name === 'string')
      .slice(0, 12)
      .map((g) => ({ id: g.id, name: g.name, verified: !!g.verified }));
  }

  async function images(gameId, kind) {
    const k = KINDS[kind];
    if (!k) throw new Error('Неизвестный вид картинки.');
    if (!Number.isInteger(gameId) || gameId <= 0) throw new Error('Неверная игра.');
    const list = await api(`/${k.section}/game/${gameId}?${k.query}&nsfw=false&humor=false`);
    return list
      .filter((i) => i && allowedUrl(i.url) && allowedUrl(i.thumb))
      .slice(0, 36)
      .map((i) => ({
        id: i.id, url: i.url, thumb: i.thumb,
        width: Number(i.width) || 0, height: Number(i.height) || 0, style: typeof i.style === 'string' ? i.style : '',
      }));
  }

  /* ---------- скачивание ---------- */

  function cleanTmp(maxAgeMs = 60 * 60 * 1000) {
    try {
      for (const f of fs.readdirSync(tmpDir)) {
        const full = path.join(tmpDir, f);
        try { if (Date.now() - fs.statSync(full).mtimeMs > maxAgeMs) fs.unlinkSync(full); } catch { /* ignore */ }
      }
    } catch { /* папки ещё нет */ }
  }

  /* Скачивает выбранную картинку во временный файл. Дальше форма обращается с ней как с файлом, выбранным кнопкой «Обзор»:
     при сохранении игры она проходит обычные проверки и копируется в папку библиотеки. */
  async function download(url) {
    const u = allowedUrl(url);
    if (!u) throw new Error('Эту картинку скачать нельзя.');
    const key = readKey();
    if (!key) { const e = new Error('Сначала укажите API-ключ SteamGridDB.'); e.code = 'NO_KEY'; throw e; }
    // Ключ уходит только в API; на CDN картинки открыты, поэтому заголовок авторизации туда не отправляем.
    let res;
    try {
      res = await net.fetch(u.href, { headers: { 'User-Agent': 'ManyGameLib' }, signal: AbortSignal.timeout(30000), redirect: 'error' });
    } catch (e) {
      throw new Error(e && e.name === 'TimeoutError' ? 'Картинка не скачалась вовремя.' : 'Не удалось скачать картинку.');
    }
    if (!res.ok) throw new Error(`Не удалось скачать картинку (${res.status}).`);
    const len = Number(res.headers.get('content-length'));
    if (len > MAX_BYTES) throw new Error('Картинка слишком большая (больше 8 МБ).');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('Картинка слишком большая (больше 8 МБ).');
    const ext = sniff(buf);
    if (!ext) throw new Error('Сервер прислал не картинку.');
    fs.mkdirSync(tmpDir, { recursive: true });
    cleanTmp();
    const out = path.join(tmpDir, `sgdb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
    fs.writeFileSync(out, buf);
    return { path: out, url: `data:${MIME[ext]};base64,${buf.toString('base64')}` };
  }

  return { hasKey, setKey, clearKey, search, images, download, cleanTmp };
}

module.exports = { createSgdb, allowedUrl, sniff };
