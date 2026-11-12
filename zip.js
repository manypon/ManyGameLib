'use strict';

/* Минимальные чтение и запись ZIP на встроенном zlib, без зависимостей.
   Нужны для переноса библиотеки: manifest.json, games.json и папка icons.
   Умеем: методы «без сжатия» и deflate, имена в UTF-8. Не умеем и отклоняем: шифрование, ZIP64, многотомные архивы.
   Читаем с защитой: размеры проверяются заранее, распаковка ограничена объявленным размером, контрольная сумма сверяется. */

const zlib = require('zlib');

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/* entries: [{ name, data: Buffer }] -> Buffer с готовым архивом. */
function writeZip(entries, now = new Date()) {
  if (entries.length >= 0xffff) throw new Error('Слишком много файлов для архива.');
  const { time, date } = dosDateTime(now);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const packed = zlib.deflateRawSync(raw);
    const stored = packed.length >= raw.length;   // сжатие не помогло: кладём как есть
    const body = stored ? raw : packed;
    const method = stored ? 0 : 8;
    const crc = crc32(raw);
    if (offset + body.length + name.length + 30 > 0xfffffff0 || raw.length > 0xfffffff0) throw new Error('Архив получился слишком большим.');

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(SIG_LOCAL, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);   // имена в UTF-8
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(SIG_CENTRAL, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);

    offset += lh.length + name.length + body.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

/* Разбирает архив и возвращает список { name, size, read() }.
   Ничего не распаковывает, пока не позвали read(): сначала можно посмотреть на имена и размеры.
   limits: maxEntries, maxEntrySize (байт в одном файле), maxTotal (байт во всех вместе). */
function readZip(buf, limits = {}) {
  const { maxEntries = 20000, maxEntrySize = 64 * 1024 * 1024, maxTotal = 2 * 1024 * 1024 * 1024 } = limits;
  const bad = (why) => new Error(`файл не похож на ZIP-архив (${why})`);
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw bad('слишком мал');

  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === SIG_END) { end = i; break; }
  }
  if (end < 0) throw bad('нет оглавления');
  const disk = buf.readUInt16LE(end + 4);
  const count = buf.readUInt16LE(end + 10);
  const cdSize = buf.readUInt32LE(end + 12);
  const cdOffset = buf.readUInt32LE(end + 16);
  if (disk !== 0 || buf.readUInt16LE(end + 6) !== 0) throw new Error('многотомные архивы не поддерживаются');
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error('ZIP64 не поддерживается');
  if (count > maxEntries) throw new Error('в архиве слишком много файлов');
  if (cdOffset + cdSize > end) throw bad('оглавление за пределами файла');

  const list = [];
  const seen = new Set();
  let total = 0;
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) throw bad('повреждено оглавление');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (p + 46 + nlen + elen + clen > buf.length) throw bad('повреждено оглавление');
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;

    if (name.endsWith('/')) continue;   // папки нам не нужны
    if (flags & 1) throw new Error('архив зашифрован');
    if (method !== 0 && method !== 8) throw new Error(`неподдерживаемый способ сжатия (${method})`);
    if (seen.has(name)) throw new Error(`в архиве два файла с именем ${name}`);
    seen.add(name);
    total += usize;
    if (total > maxTotal) throw new Error('распакованные данные слишком велики');

    list.push({
      name,
      size: usize,
      read() {
        if (usize > maxEntrySize) throw new Error(`файл ${name} слишком велик`);
        if (local + 30 > buf.length || buf.readUInt32LE(local) !== SIG_LOCAL) throw bad('повреждён заголовок файла');
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        if (start + csize > buf.length) throw bad('данные за пределами файла');
        const body = buf.subarray(start, start + csize);
        let data;
        if (method === 0) {
          data = Buffer.from(body);
        } else {
          try { data = zlib.inflateRawSync(body, { maxOutputLength: Math.max(usize, 1) }); }
          catch { throw new Error(`файл ${name} не распаковывается`); }
        }
        if (data.length !== usize || crc32(data) !== crc) throw new Error(`файл ${name} повреждён`);
        return data;
      },
    });
  }
  return list;
}

module.exports = { writeZip, readZip, crc32 };
