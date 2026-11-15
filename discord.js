'use strict';

/* Discord Rich Presence («Играет в …» в профиле Discord) по локальному IPC. Без внешних библиотек.
   Discord слушает именованный канал \\?\pipe\discord-ipc-0…9 (на Linux/macOS: сокет в каталоге временных файлов).
   Обмен кадрами: заголовок из двух чисел int32 LE (код операции и длина), затем JSON. Нужен Application ID приложения
   с discord.com/developers (его вводит пользователь): Discord показывает «Играет в <имя приложения>».
   Модуль ничего не пишет на диск и не читает чужих данных: наружу уходят только название игры и время начала.
   Любая ошибка (Discord закрыт, канал не найден) тихо превращается в статус, на запуск игр это не влияет. */

const net = require('net');
const os = require('os');
const path = require('path');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const ID_RE = /^\d{17,20}$/;
const CONNECT_TIMEOUT_MS = 3000;

function defaultPipePath(i) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || os.tmpdir();
  return path.join(base, `discord-ipc-${i}`);
}

function encode(op, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/* Разбор потока кадров: возвращает функцию-приёмник чанков, которая зовёт onFrame(op, data). */
function decoder(onFrame) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) {
      const op = buf.readInt32LE(0);
      const len = buf.readInt32LE(4);
      if (len < 0 || len > 1 << 20) { buf = Buffer.alloc(0); return; }   // мусор: выбрасываем
      if (buf.length < 8 + len) return;
      let data = null;
      try { data = JSON.parse(buf.slice(8, 8 + len).toString('utf8')); } catch { /* пустой или битый кадр */ }
      buf = buf.slice(8 + len);
      onFrame(op, data);
    }
  };
}

function createDiscord({ log = () => {}, pipePath = defaultPipePath, pid = process.pid } = {}) {
  let sock = null;
  let ready = false;
  let clientId = '';
  let connecting = null;   // Promise текущего подключения
  let error = '';
  let nonce = 0;

  function drop() {
    ready = false;
    if (sock) { try { sock.destroy(); } catch { /* ignore */ } }
    sock = null;
  }

  function tryPipe(i, id) {
    return new Promise((resolve, reject) => {
      const s = net.connect(pipePath(i));
      let done = false;
      let timer = null;
      const fail = (e) => { if (done) return; done = true; clearTimeout(timer); try { s.destroy(); } catch { /* ignore */ } reject(e); };
      timer = setTimeout(() => fail(new Error('Discord не ответил')), CONNECT_TIMEOUT_MS);
      timer.unref();
      s.on('error', fail);
      s.once('connect', () => s.write(encode(OP.HANDSHAKE, { v: 1, client_id: id })));
      s.on('data', decoder((op, data) => {
        if (op === OP.PING) { try { s.write(encode(OP.PONG, data || {})); } catch { /* ignore */ } return; }
        if (op === OP.CLOSE) { fail(new Error((data && data.message) || 'Discord закрыл соединение')); return; }
        if (!done && op === OP.FRAME && data && data.evt === 'READY') { done = true; clearTimeout(timer); resolve(s); }
        if (!done && op === OP.FRAME && data && data.evt === 'ERROR') fail(new Error((data.data && data.data.message) || 'Discord отклонил запрос'));
      }));
    });
  }

  async function connect(id) {
    let last = new Error('Discord не запущен');
    for (let i = 0; i < 10; i++) {
      try {
        const s = await tryPipe(i, id);
        s.on('close', () => { if (sock === s) { sock = null; ready = false; } });
        s.on('error', () => {});
        sock = s;
        ready = true;
        return;
      } catch (e) { last = e; if (/Application ID|client|Invalid/i.test(String(e.message))) break; }
    }
    throw last;
  }

  async function ensure(id) {
    if (ready && sock && clientId === id) return;
    if (clientId !== id) drop();
    clientId = id;
    if (!connecting) connecting = connect(id).finally(() => { connecting = null; });
    await connecting;
  }

  function send(activity) {
    if (!ready || !sock) return false;
    sock.write(encode(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid, activity: activity || null }, nonce: String(++nonce) }));
    return true;
  }

  /* activity: { details, state, start (мс) } или null, чтобы убрать статус. */
  async function set(id, activity) {
    if (!ID_RE.test(String(id || ''))) { error = 'Application ID должен состоять из 17–20 цифр'; return false; }
    try {
      await ensure(String(id));
      const act = { details: activity.details, timestamps: { start: Math.floor(activity.start / 1000) } };
      if (activity.state) act.state = activity.state;
      send(act);
      error = '';
      return true;
    } catch (e) {
      error = String((e && e.message) || e);
      drop();
      log('warn', `Discord: ${error}`);
      return false;
    }
  }

  /* Убирает статус и закрывает соединение (когда игры нет, держать канал незачем). */
  function clear() {
    if (ready && sock) { try { send(null); } catch { /* ignore */ } }
    const s = sock;
    ready = false;
    sock = null;
    if (s) setTimeout(() => { try { s.destroy(); } catch { /* ignore */ } }, 200).unref();
  }

  return { set, clear, status: () => ({ connected: ready, error }), _drop: drop };
}

module.exports = { createDiscord, encode, decoder, OP, ID_RE };
