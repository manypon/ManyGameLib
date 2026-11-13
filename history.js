'use strict';

/* История сессий и статистика. Живёт в главном процессе.

   Каждая закончившаяся сессия (не короче минуты, как и для времени в игре) дописывается в sessions.json:
   { id, name, start, sec }. Из этого журнала считаются «за 7 и 30 дней», график по дням, топ игр за период и серии дней.
   Журнал не влияет на games.json: повреждённый файл откладывается в сторону, и журнал начинается заново.
   Время, наигранное до появления журнала, в эти цифры не входит (оно есть только в общем «наиграно»). */

const fs = require('fs');
const path = require('path');

const MAX_ENTRIES = 20000;           // дальше самые старые записи отбрасываются
const MAX_SESSION_SEC = 30 * 24 * 3600;
const DAY_MS = 24 * 3600 * 1000;
const CHART_DAYS = 30;

/* Начало местных суток через Date, а не прибавлением 24 часов: так не ломается переход на летнее время. */
const dayStartOf = (ts) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const addDays = (ts, n) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const start = Number(e.start);
  const sec = Math.round(Number(e.sec));
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(sec) || sec < 1 || sec > MAX_SESSION_SEC) return null;
  if (typeof e.id !== 'string' || !e.id) return null;
  return { id: e.id, name: typeof e.name === 'string' ? e.name.slice(0, 80) : '', start: Math.round(start), sec };
}

function createHistory({ file, log = () => {} }) {
  let list = [];

  function load() {
    list = [];
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return; }   // файла ещё нет
    try {
      const raw = JSON.parse(text.replace(/^﻿/, ''));
      if (!Array.isArray(raw)) throw new Error('неверный формат');
      list = raw.map(cleanEntry).filter(Boolean).slice(-MAX_ENTRIES);
    } catch (e) {
      list = [];
      const kept = file.replace(/\.json$/, `.corrupt-${Date.now()}.json`);
      try { fs.renameSync(file, kept); } catch { /* ignore */ }
      log('warn', `журнал сессий повреждён (${e.message}), начат заново; старый файл: ${kept}`);
    }
  }

  function save() {
    const tmp = `${file}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(list));
    fs.renameSync(tmp, file);
  }

  /* Дописывает сессию. Сбой записи не должен ломать подсчёт времени, поэтому ошибку только пишем в журнал. */
  function add(entry) {
    const e = cleanEntry(entry);
    if (!e) return false;
    list.push(e);
    if (list.length > MAX_ENTRIES) list = list.slice(-MAX_ENTRIES);
    try { save(); return true; }
    catch (err) { list.pop(); log('error', `журнал сессий не сохранён: ${err.message}`); return false; }
  }

  /* Сколько миллисекунд сессии попало в окно [from, to). */
  const overlap = (e, from, to) => Math.max(0, Math.min(e.start + e.sec * 1000, to) - Math.max(e.start, from));

  /* games: текущая библиотека (общее время и названия). now: для проверок. */
  function stats(games, now = Date.now()) {
    const today = dayStartOf(now);
    const first = addDays(today, -(CHART_DAYS - 1));
    const days = [];
    for (let i = 0; i < CHART_DAYS; i++) {
      const from = addDays(first, i);
      days.push({ day: dayKey(from), from, to: addDays(first, i + 1), sec: 0 });
    }
    const names = new Map(games.map((g) => [g.id, g.name]));
    const perGame = { week: new Map(), month: new Map() };
    const weekFrom = days[CHART_DAYS - 7].from;
    const activeDays = new Set();
    let longest = 0;

    for (const e of list) {
      longest = Math.max(longest, e.sec);
      // дни, в которые игра шла: по началу и концу сессии (ночная игра охватывает обе даты)
      for (let t = dayStartOf(e.start); t < e.start + e.sec * 1000; t = addDays(t, 1)) activeDays.add(dayKey(t));
      if (e.start + e.sec * 1000 <= first || e.start >= days[CHART_DAYS - 1].to) continue;
      for (const d of days) {
        const ms = overlap(e, d.from, d.to);
        if (!ms) continue;
        d.sec += ms / 1000;
        const add = (m) => m.set(e.id, { id: e.id, name: names.get(e.id) || e.name || 'Без названия', sec: (m.get(e.id)?.sec || 0) + ms / 1000 });
        add(perGame.month);
        if (d.from >= weekFrom) add(perGame.week);
      }
    }

    const top = (m) => [...m.values()].map((x) => ({ ...x, sec: Math.round(x.sec) })).sort((a, b) => b.sec - a.sec).slice(0, 10);
    const sumDays = (n) => Math.round(days.slice(-n).reduce((s, d) => s + d.sec, 0));

    // серии: подряд идущие дни с игрой; текущая считается, если играли сегодня или вчера
    let best = 0;
    let run = 0;
    const keys = [...activeDays].sort();
    let prev = null;
    for (const k of keys) {
      const [y, mo, d] = k.split('-').map(Number);
      const ts = new Date(y, mo - 1, d).getTime();
      run = prev !== null && dayKey(addDays(prev, 1)) === k ? run + 1 : 1;
      best = Math.max(best, run);
      prev = ts;
    }
    let streak = 0;
    for (let t = activeDays.has(dayKey(today)) ? today : addDays(today, -1); activeDays.has(dayKey(t)); t = addDays(t, -1)) streak += 1;

    const libTotal = games.reduce((s, g) => s + (Number(g.playtime_sec) || 0), 0);
    return {
      total_sec: libTotal,
      games: games.length,
      games_played: games.filter((g) => (Number(g.playtime_sec) || 0) > 0).length,
      week_sec: sumDays(7),
      month_sec: sumDays(30),
      sessions: list.length,
      longest_session_sec: longest,
      streak_days: streak,
      best_streak_days: best,
      days: days.map((d) => ({ day: d.day, sec: Math.round(d.sec) })),
      top: {
        all: games.filter((g) => (Number(g.playtime_sec) || 0) > 0)
          .map((g) => ({ id: g.id, name: g.name, sec: Number(g.playtime_sec) }))
          .sort((a, b) => b.sec - a.sec).slice(0, 10),
        week: top(perGame.week),
        month: top(perGame.month),
      },
      history_since: list.length ? list[0].start : null,
    };
  }

  return { load, add, stats, size: () => list.length, entries: () => list.slice() };
}

module.exports = { createHistory, cleanEntry, MAX_ENTRIES };
