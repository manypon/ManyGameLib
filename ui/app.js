'use strict';

/* =========================================================
   ManyGameLib — интерфейс. Вся работа с файлами и запуском игр
   выполняется в главном процессе Electron (main.js), здесь только UI.
   ========================================================= */

const invoke = (cmd, args = {}) => window.api.invoke(cmd, args);
const dialog = { open: (opts) => window.api.pickFile(opts) };
const appWindow = {
  minimize: () => window.api.win('minimize'),
  toggleMaximize: () => window.api.win('toggleMaximize'),
  close: () => window.api.win('close'),
};

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'ico', 'bmp', 'gif'];
const DEFAULT_HERO = { bg: 'blur', art: true, fit: 'cover' };

const state = {
  games: [],
  assets: {},           // id -> { icon, banner, logo }: тяжёлые картинки, грузим по требованию
  heroId: null,         // игра, которая сейчас показана в верхнем блоке
  view: 'library',      // library | favorites | recent | profile | settings
  query: '',
  tagFilter: [],        // выбранные теги (в нижнем регистре): остаются игры, у которых есть все
  sort: 'name',         // name | added | played | playtime
  layout: 'grid',       // grid | list
  selectedId: null,
  settingsTab: 'general', // вкладка страницы настроек: general | appearance | library | about
  appInfo: null,        // сведения о приложении для вкладки «О приложении»
  update: null,         // состояние обновлений из updater.js (status, mode, version, progress, error)
  settings: null,       // настройки приложения (get_settings)
  trash: null,          // корзина (list_trash); null: загрузить заново
  profile: null,        // профиль (get_profile): ник, аватар, дата начала
  stats: null,          // статистика (get_stats)
  topRange: 'month',    // top игр: all | month | week
  wallpaper: null,      // data URL своей картинки фона (грузится, только если она выбрана)
};

/* ---------- Утилиты ---------- */

const $ = (sel) => document.querySelector(sel);

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // только для статичных SVG-иконок
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

const svg = (inner, extra = '') =>
  `<svg viewBox="0 0 24 24" ${extra}>${inner}</svg>`;

const ICON = {
  play: svg('<path d="M7 4.5v15l13-7.5z"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.1"/>'),
  more: svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>', 'style="fill:currentColor;stroke:none"'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  star: svg('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8L3.5 9.7l5.9-.9z"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  close: svg('<path d="m5 5 14 14M19 5 5 19"/>'),
  grid: svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
  list: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>'),
  user: svg('<circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>'),
  folder: svg('<path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>'),
  image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>'),
};

const icon = (name) => h('span', { html: ICON[name], style: 'display:contents' });

function plural(n, [one, few, many]) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* Время в игре в часах: 12,5 ч; до 100 ч с десятой долей, дальше целое число. */
function formatHours(sec) {
  const h = sec / 3600;
  if (h >= 100) return `${Math.round(h)} ч`;
  const v = Math.round(h * 10) / 10;
  if (sec > 0 && v === 0) return 'меньше 0,1 ч';
  return `${String(v).replace('.', ',')} ч`;
}

function formatLast(ts) {
  if (!ts) return 'Ещё не запускалась';
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 864e5);
  if (days <= 0) return 'Сегодня';
  if (days === 1) return 'Вчера';
  if (days < 7) return `${days} ${plural(days, ['день', 'дня', 'дней'])} назад`;
  if (days < 14) return 'Неделю назад';
  if (days < 30) { const w = Math.floor(days / 7); return `${w} ${plural(w, ['неделю', 'недели', 'недель'])} назад`; }
  if (days < 60) return 'Месяц назад';
  if (days < 365) { const m = Math.floor(days / 30); return `${m} ${plural(m, ['месяц', 'месяца', 'месяцев'])} назад`; }
  const y = Math.floor(days / 365);
  return y === 1 ? 'Год назад' : `${y} ${plural(y, ['год', 'года', 'лет'])} назад`;
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function hueOf(str) {
  let x = 0;
  for (const ch of String(str)) x = (x * 31 + ch.codePointAt(0)) >>> 0;
  return x % 360;
}

function errText(e) {
  return typeof e === 'string' ? e : (e && e.message) || 'Что-то пошло не так';
}

/* Обложка: иконка игры или цветная заглушка с первой буквой. */
function coverNode(game) {
  if (game.icon) return h('img', { src: game.icon, alt: '', draggable: 'false' });
  const hue = hueOf(game.name);
  // [...строка] делит по символам, а не по половинкам суррогатных пар (эмодзи).
  const letter = ([...String(game.name).trim()][0] || '?').toUpperCase();
  return h('div', {
    class: 'cover-fill',
    style: `background:linear-gradient(135deg,hsl(${hue} 62% 46%),hsl(${(hue + 40) % 360} 58% 26%))`,
  }, letter);
}

/* action: { label, onClick }: кнопка в уведомлении (например, «Отменить»); с ней уведомление висит дольше. */
function toast(msg, type = 'ok', action = null) {
  const t = h('div', { class: `toast ${type}` }, msg);
  let timer = null;
  const hide = () => {
    clearTimeout(timer);
    t.classList.add('out');
    setTimeout(() => t.remove(), 220);
  };
  if (action) {
    t.append(h('button', { class: 'toast-action', type: 'button', onClick: () => { hide(); action.onClick(); } }, action.label));
  }
  $('#toasts').append(t);
  timer = setTimeout(hide, action ? 8000 : type === 'error' ? 5200 : 2800);
}

/* ---------- Данные ---------- */

function upsert(game) {
  const i = state.games.findIndex((g) => g.id === game.id);
  if (i >= 0) state.games[i] = game; else state.games.push(game);
}

async function refresh() {
  try {
    state.games = await invoke('get_games');
  } catch (e) {
    toast(errText(e), 'error');
  }
  render();
}

/* При возвращении в окно обновляем метки «Файл не найден»:
   например, подключили диск с играми или вернули перенесённый файл. */
async function syncMissing() {
  if (!state.games.length) return;
  try {
    const missing = new Set(await invoke('get_missing'));
    let changed = false;
    for (const g of state.games) {
      const m = missing.has(g.id);
      if (g.missing !== m) { g.missing = m; changed = true; }
    }
    if (changed) render();
  } catch { /* не критично */ }
}

const pendingAssets = new Set();
async function loadAssets(id) {
  if (pendingAssets.has(id)) return;
  pendingAssets.add(id);
  try {
    state.assets[id] = await invoke('get_assets', { id });
  } catch {
    state.assets[id] = { icon: null, banner: null, logo: null };
  }
  pendingAssets.delete(id);
  if (state.heroId === id) render();
}

/* ---------- Защита от повторного запуска ---------- */

const LAUNCH_LOCK_MS = 3000;
const launching = new Map(); // id игры -> таймер, который снимет блокировку

function isRunning(id) {
  const g = state.games.find((x) => x.id === id);
  return !!(g && g.running);
}

/* Как в Steam: пока игра запускается или идёт, её кнопки отключены и подписаны
   «Запускается…» / «Играет». Состояние «идёт» приходит из главного процесса вместе с игрой. */
function refreshLaunchButtons() {
  document.querySelectorAll('[data-launch-id]').forEach((el) => {
    const id = el.dataset.launchId;
    const running = isRunning(id);
    const starting = !running && launching.has(id);
    el.disabled = running || starting;
    el.classList.toggle('is-launching', starting);
    el.classList.toggle('is-running', running);
    const label = el.querySelector('.btn-label');
    if (label) label.textContent = running ? 'Играет' : starting ? 'Запускается…' : 'Запустить';
  });
}

function lockLaunch(id) {
  clearTimeout(launching.get(id));
  launching.set(id, setTimeout(() => unlockLaunch(id), LAUNCH_LOCK_MS));
  refreshLaunchButtons();
}

function unlockLaunch(id) {
  clearTimeout(launching.get(id));
  launching.delete(id);
  refreshLaunchButtons();
}

async function launch(id) {
  const game = state.games.find((g) => g.id === id);
  if (!game || game.running || launching.has(id)) return; // уже идёт или запускается: повторное нажатие игнорируем
  lockLaunch(id);
  try {
    const updated = await invoke('launch_game', { id });
    upsert(updated);
    toast(updated.running ? `«${game.name}» запущена` : `Запускаю «${game.name}»`);
  } catch (e) {
    unlockLaunch(id); // не запустилась: даём попробовать сразу
    toast(errText(e), 'error');
    await refresh();
    return;
  }
  render();
}

async function toggleFavorite(id) {
  try {
    upsert(await invoke('toggle_favorite', { id }));
    render();
  } catch (e) {
    toast(errText(e), 'error');
  }
}

/* Без вопроса: игра уходит в корзину, а «Отменить» в уведомлении возвращает её. Сама игра на диске не затрагивается. */
async function removeGame(id) {
  const game = state.games.find((g) => g.id === id);
  if (!game) return;
  try {
    await invoke('remove_game', { id });
    state.games = state.games.filter((g) => g.id !== id);
    delete state.assets[id];
    if (state.selectedId === id) state.selectedId = null;
    state.trash = null;   // список корзины в настройках загрузится заново
    render();
    toast(`«${game.name}» убрана из библиотеки`, 'ok', { label: 'Отменить', onClick: () => restoreGame(id) });
  } catch (e) {
    toast(errText(e), 'error');
  }
}

async function restoreGame(id) {
  try {
    const game = await invoke('restore_game', { id });
    upsert(game);
    state.trash = null;
    render();
    toast(`«${game.name}» возвращена в библиотеку`);
  } catch (e) {
    toast(errText(e), 'error');
  }
}

/* ---------- Выборки ---------- */

const byName = (a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' });
const byPlayed = (a, b) => (b.last_played || 0) - (a.last_played || 0);
const byPlaytime = (a, b) => (b.playtime_sec || 0) - (a.playtime_sec || 0);

function sorted(list) {
  const copy = [...list];
  if (state.sort === 'added') copy.sort((a, b) => b.added_at - a.added_at);
  else if (state.sort === 'played') copy.sort((a, b) => byPlayed(a, b) || byName(a, b));
  else if (state.sort === 'playtime') copy.sort((a, b) => byPlaytime(a, b) || byName(a, b));
  else copy.sort(byName);
  return copy;
}

const recentGames = () => state.games.filter((g) => g.last_played).sort(byPlayed);

/* ---------- Теги ---------- */

const MAX_TAGS = 12;
const MAX_TAG_LEN = 24;
const tagKey = (t) => t.toLowerCase();

/* Все теги библиотеки с числом игр. Теги с разным регистром считаются одним, показывается первый встреченный. */
function allTags() {
  const map = new Map();
  for (const g of state.games) {
    for (const t of g.tags || []) {
      const k = tagKey(t);
      const e = map.get(k);
      if (e) e.count += 1; else map.set(k, { key: k, name: t, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

const byTags = (list) => (state.tagFilter.length
  ? list.filter((g) => state.tagFilter.every((k) => (g.tags || []).some((t) => tagKey(t) === k)))
  : list);

function matches(list) {
  const q = state.query.trim().toLowerCase();
  return byTags(q ? list.filter((g) => g.name.toLowerCase().includes(q)) : list);
}

function tagFilterNames() {
  const all = allTags();
  return state.tagFilter.map((k) => (all.find((t) => t.key === k) || { name: k }).name);
}

function toggleTag(key) {
  const i = state.tagFilter.indexOf(key);
  if (i >= 0) state.tagFilter.splice(i, 1); else state.tagFilter.push(key);
  if (state.view === 'settings') state.view = 'library';
  render();
  $('#content').scrollTop = 0;
}

function clearTagFilter() {
  state.tagFilter = [];
  render();
}

function renderTagsBlock() {
  const box = $('#tagsBlock');
  const tags = allTags();
  state.tagFilter = state.tagFilter.filter((k) => tags.some((t) => t.key === k));   // тег пропал из библиотеки: фильтр по нему снимается сам
  box.hidden = !tags.length;
  if (!tags.length) { box.replaceChildren(); return; }
  box.replaceChildren(
    h('div', { class: 'tags-head' },
      h('span', {}, 'Теги'),
      state.tagFilter.length ? h('button', { class: 'tags-reset', type: 'button', onClick: clearTagFilter }, 'Сбросить') : null),
    h('div', { class: 'tags-list' }, tags.map((t) => h('button', {
      class: `tag-item${state.tagFilter.includes(t.key) ? ' active' : ''}`, type: 'button',
      title: 'Правая кнопка: переименовать или удалить тег',
      onClick: () => toggleTag(t.key),
      onContextmenu: (e) => openTagMenu(e, t),
    }, h('span', { class: 'tag-name' }, t.name), h('span', { class: 'tag-count' }, String(t.count))))));
}

/* Меню тега: переименовать или удалить во всех играх. */
function openTagMenu(e, tag) {
  e.preventDefault();
  e.stopPropagation();
  const m = $('#menu');
  const item = (cls, ic, label, fn) =>
    h('button', { class: cls, type: 'button', onClick: () => { closeMenu(); fn(); } }, icon(ic), label);
  m.replaceChildren(
    item('', 'edit', 'Переименовать', () => renameTagModal(tag)),
    h('hr'),
    item('danger', 'trash', 'Удалить тег', () => deleteTag(tag)));
  m.hidden = false;
  menuTrigger = null;
  const { width, height } = m.getBoundingClientRect();
  m.style.left = `${Math.max(8, Math.min(e.clientX, window.innerWidth - width - 8))}px`;
  m.style.top = `${Math.max(8, Math.min(e.clientY, window.innerHeight - height - 8))}px`;
}

async function applyTagRename(from, to) {
  const changed = await invoke('rename_tag', { from, to });
  changed.forEach(upsert);
  // Активный фильтр по этому тегу переезжает на новое имя (или пропадает при удалении).
  const fk = tagKey(from);
  const nk = tagKey(to.trim().slice(0, MAX_TAG_LEN).trim());
  state.tagFilter = [...new Set(state.tagFilter.map((k) => (k === fk ? nk : k)).filter(Boolean))];
  render();
  return changed.length;
}

function renameTagModal(tag) {
  openModal((modal) => {
    modal.style.maxWidth = '440px';
    const input = h('input', { class: 'input', type: 'text', value: tag.name, maxlength: MAX_TAG_LEN, spellcheck: false });
    const error = h('div', { class: 'form-error', hidden: true });
    const save = async () => {
      const to = input.value.trim();
      if (!to) { error.textContent = 'Введите новое имя тега.'; error.hidden = false; return; }
      try {
        await applyTagRename(tag.name, to);
        closeModal();
        toast('Тег переименован');
      } catch (e2) { error.textContent = errText(e2); error.hidden = false; }
    };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); save(); } });
    modal.append(
      h('div', { class: 'modal-head' }, h('h3', {}, 'Переименовать тег'), h('button', { class: 'x-btn', type: 'button', title: 'Закрыть', onClick: closeModal }, icon('close'))),
      h('p', {}, `Новое имя получат все игры с тегом «${tag.name}» (${tag.count}). Если такой тег уже есть, они сольются.`),
      input, error,
      h('div', { class: 'modal-actions', style: 'margin-top:14px' },
        h('button', { class: 'btn ghost small', type: 'button', onClick: closeModal }, 'Отмена'),
        h('button', { class: 'btn primary small', type: 'button', onClick: save }, 'Сохранить')));
    setTimeout(() => { input.focus(); input.select(); }, 40);
  });
}

async function deleteTag(tag) {
  const ok = await confirmModal({
    title: `Удалить тег «${tag.name}»?`,
    text: `Тег будет убран у игр: ${tag.count}. Сами игры останутся в библиотеке.`,
    okLabel: 'Удалить',
  });
  if (!ok) return;
  try { await applyTagRename(tag.name, ''); toast('Тег удалён'); } catch (e) { toast(errText(e), 'error'); }
}

/* ---------- Рендер ---------- */

function render() {
  const content = $('#content');
  const scroll = content.scrollTop;

  const n = state.games.length;
  $('#libCount').textContent = `${n} ${plural(n, ['игра', 'игры', 'игр'])}`;
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === state.view && !state.query));

  renderTagsBlock();
  content.replaceChildren();
  content.classList.remove('pad-top');
  state.heroId = null;

  if (n === 0) {
    content.append(renderWelcome());
  } else if (state.query.trim()) {
    content.classList.add('pad-top');
    content.append(renderSearch());
  } else if (state.view === 'profile') {
    content.classList.add('pad-top');
    content.append(renderProfile());
  } else if (state.view === 'settings') {
    content.classList.add('pad-top');
    content.append(renderSettings());
  } else if (state.view === 'favorites') {
    content.classList.add('pad-top');
    content.append(renderSimple('Избранное', byTags(state.games.filter((g) => g.favorite)).sort(byName),
      'Пока пусто', state.tagFilter.length ? NO_TAGGED : 'Нажмите «⋯» у игры и добавьте её в избранное.', false));
  } else if (state.view === 'recent') {
    content.classList.add('pad-top');
    content.append(renderSimple('Недавние игры', byTags(recentGames()),
      'Вы ещё ничего не запускали', state.tagFilter.length ? NO_TAGGED : 'Здесь появятся игры, которые вы запустили из ManyGameLib.', true));
  } else if (state.tagFilter.length) {
    content.classList.add('pad-top');
    const found = sorted(byTags(state.games));
    content.append(renderSimple(`Теги: ${tagFilterNames().join(' + ')} (${found.length})`, found,
      'Нет таких игр', NO_TAGGED, false));
  } else {
    content.append(...renderLibrary());
  }

  content.scrollTop = scroll;
  refreshLaunchButtons();
}

const NO_TAGGED = 'Нет игр со всеми выбранными тегами. Снимите тег в боковом меню.';

/* Первый запуск: библиотека пуста — просим добавить первую игру. */
function renderWelcome() {
  const form = gameForm({
    onDone: (game) => {
      upsert(game);
      state.selectedId = game.id;
      state.view = 'library';
      render();
      toast(`«${game.name}» добавлена в библиотеку`);
    },
  });
  return h('div', { class: 'welcome' },
    h('div', { class: 'welcome-card' },
      h('div', { class: 'welcome-hero' },
        h('div', { class: 'welcome-logo', html: ICON.play }),
        h('h1', {}, 'Добавьте первую игру'),
        h('p', {}, 'Укажите файл запуска, название и при желании картинки. Дальше запускать игру можно одним нажатием.')),
      h('div', { class: 'welcome-form' }, form)));
}

/* Горизонтальная полоса: колесо мыши листает её вбок, а на краях отдаёт прокрутку странице. */
function railNode(children) {
  const rail = h('div', { class: 'rail' }, children);
  rail.addEventListener('wheel', (e) => {
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const max = rail.scrollWidth - rail.clientWidth;
    if (max <= 0) return;
    const next = Math.max(0, Math.min(max, rail.scrollLeft + e.deltaY));
    if (next === rail.scrollLeft) return;
    e.preventDefault();
    rail.scrollLeft = next;
  }, { passive: false });
  return rail;
}

/* Какая игра сейчас в верхнем блоке и какие точки-кандидаты показывать. */
function heroChoice() {
  const recent = recentGames();
  const pool = recent.length ? recent : sorted(state.games);
  const candidates = pool.slice(0, 4);
  const hero = state.games.find((g) => g.id === state.selectedId) || candidates[0];
  return { hero, candidates };
}

function renderLibrary() {
  const parts = [];
  const recent = recentGames();
  const { hero, candidates } = heroChoice();
  parts.push(renderHero(hero, candidates));

  if (recent.length) {
    parts.push(h('section', { class: 'section' },
      h('div', { class: 'section-head' },
        h('h2', {}, 'Недавние игры'),
        h('button', { class: 'link-btn', onClick: () => setView('recent') }, 'Показать все', icon('arrow'))),
      railNode(recent.slice(0, 8).map((g) => card(g, { chip: true, hero: true })))));
  }

  const all = sorted(state.games);
  parts.push(h('section', { class: 'section' },
    h('div', { class: 'section-head' },
      h('h2', {}, 'Все игры'),
      h('div', { class: 'tools' },
        sortSelect(),
        h('div', { class: 'seg' },
          h('button', { class: state.layout === 'grid' ? 'on' : '', title: 'Плитки', onClick: () => setLayout('grid') }, icon('grid')),
          h('button', { class: state.layout === 'list' ? 'on' : '', title: 'Список', onClick: () => setLayout('list') }, icon('list'))))),
    state.layout === 'grid'
      ? h('div', { class: 'grid' }, all.map((g) => card(g, { hero: true })), addTile())
      : h('div', { class: 'list' }, all.map((g) => row(g, true)),
          h('button', { class: 'btn ghost small', style: 'align-self:flex-start;margin-top:10px', onClick: openAddModal }, icon('plus'), 'Добавить игру'))));

  return parts;
}

/* Верхний блок. g: название, путь, иконка, баннер, логотип и настройки hero.
   Один и тот же код рисует и настоящий блок, и предпросмотр в форме. */
function heroNode(g, { preview = false, dots = null } = {}) {
  const hero = { ...DEFAULT_HERO, ...(g.hero || {}) };
  const hue = hueOf(g.name || '');
  const gradient = `background:linear-gradient(135deg,hsl(${hue} 55% 28%),hsl(${(hue + 50) % 360} 55% 12%))`;

  let bg;
  if (hero.bg === 'banner' && g.banner) bg = h('img', { class: 'sharp', src: g.banner, alt: '' });
  else if (hero.bg === 'blur' && g.icon) bg = h('img', { src: g.icon, alt: '' });
  else bg = h('div', { class: 'fallback', style: gradient });

  let art = null;
  if (hero.art) {
    art = h('div', { class: `hero-art fit-${hero.fit}` },
      hero.fit === 'contain' && g.icon ? h('img', { src: g.icon, alt: '' }) : coverNode(g));
  }

  const title = g.logo
    ? h('img', { class: 'hero-logo', src: g.logo, alt: g.name, title: g.name })
    : h('h1', { class: 'hero-title' }, g.name);

  const go = (fn) => (preview ? null : fn);

  return h('section', { class: 'hero' + (preview ? ' is-preview' : '') },
    h('div', { class: 'hero-bg' }, bg),
    art,
    h('div', { class: 'hero-body' },
      h('div', { class: 'hero-eyebrow' }, icon('clock'), g.last_played ? 'Последний запуск' : 'В библиотеке'),
      title,
      h('p', { class: 'hero-sub' },
        (g.last_played ? formatLast(g.last_played) : 'Ещё не запускалась') + (g.playtime_sec > 0 ? ` · Наиграно ${formatHours(g.playtime_sec)}` : '')),
      h('p', { class: 'hero-path', title: g.exe_path }, g.exe_path),
      h('div', { class: 'hero-actions' },
        h('button', { class: 'btn primary', type: 'button', 'data-launch-id': preview ? null : g.id, onClick: go(() => launch(g.id)) },
          icon('play'), h('span', { class: 'btn-label' }, 'Запустить')),
        h('button', { class: 'btn ghost', type: 'button', onClick: go(() => openDetails(g.id)) }, icon('info'), 'Подробнее'),
        h('button', { class: 'btn ghost icon', type: 'button', title: 'Ещё', 'data-menu-trigger': true, onClick: go((e) => openMenu(e, g)) }, icon('more')))),
    dots && dots.length > 1 && h('div', { class: 'hero-dots' },
      dots.map((c) => h('button', {
        class: c.id === g.id ? 'on' : '',
        title: c.name,
        onClick: () => selectGame(c.id, false),
      }))));
}

function renderHero(game, candidates) {
  state.heroId = game.id;
  const assets = state.assets[game.id];
  if (!assets && (game.has_banner || game.has_logo)) loadAssets(game.id);

  // Если выбранной игры нет среди первых четырёх, показываем для неё отдельную точку.
  const dots = candidates.some((c) => c.id === game.id) ? candidates : [...candidates, game];
  return heroNode({ ...game, banner: assets && assets.banner, logo: assets && assets.logo }, { dots });
}

function sortSelect() {
  const sel = h('select', { onChange: (e) => { state.sort = e.target.value; render(); } },
    h('option', { value: 'name' }, 'По названию'),
    h('option', { value: 'added' }, 'По дате добавления'),
    h('option', { value: 'played' }, 'По последнему запуску'),
    h('option', { value: 'playtime' }, 'По времени в игре'));
  sel.value = state.sort;
  return h('div', { class: 'select' }, sel);
}

function renderSimple(title, games, emptyTitle, emptyText, withChips) {
  const content = h('section', { class: 'section', style: 'margin-top:0' },
    h('div', { class: 'section-head' }, h('h2', {}, title)));
  if (!games.length) {
    content.append(h('div', { class: 'empty' }, h('b', {}, emptyTitle), emptyText));
  } else {
    content.append(h('div', { class: 'grid' }, games.map((g) => card(g, { chip: withChips }))));
  }
  return content;
}

function renderSearch() {
  const found = sorted(matches(state.games));
  const section = h('section', { class: 'section', style: 'margin-top:0' },
    h('div', { class: 'section-head' },
      h('h2', {}, `Результаты поиска (${found.length})`)));
  if (!found.length) {
    section.append(h('div', { class: 'empty' }, h('b', {}, 'Ничего не найдено'), `По запросу «${state.query.trim()}» игр нет${state.tagFilter.length ? ' среди выбранных тегов' : ''}.`));
  } else {
    section.append(h('div', { class: 'grid' }, found.map((g) => card(g, {}))));
  }
  return section;
}

/* ---------- Страница настроек ---------- */

const SETTINGS_TABS = [
  { id: 'general', label: 'Общие', icon: 'gear' },
  { id: 'appearance', label: 'Внешний вид', icon: 'image' },
  { id: 'library', label: 'Библиотека', icon: 'folder' },
  { id: 'about', label: 'О приложении', icon: 'info' },
];

let appInfoPending = false;
function ensureAppInfo() {
  if (state.appInfo || appInfoPending) return;
  appInfoPending = true;
  invoke('get_app_info')
    .then((info) => { state.appInfo = info; })
    .catch((e) => toast(errText(e), 'error'))
    .finally(() => { appInfoPending = false; if (state.view === 'settings') render(); });
}

async function openTarget(target) {
  try { await invoke('open_external', { target }); } catch (e) { toast(errText(e), 'error'); }
}

/* Карточка с заголовком и строками «название слева, значение или кнопка справа». */
function settingsCard(title, subtitle, ...rows) {
  return h('section', { class: 's-card' },
    h('div', { class: 's-card-head' }, h('h3', {}, title), subtitle && h('p', {}, subtitle)),
    rows);
}

function settingRow(title, hint, control) {
  return h('div', { class: 's-row' },
    h('div', { class: 's-text' }, h('b', {}, title), hint && h('span', {}, hint)),
    h('div', { class: 's-control' }, control));
}

/* ---------- Фон приложения ---------- */

const DEFAULT_WALLPAPER = 'assets/wallpaper-default.webp';

/* Показывает фон по текущим настройкам. Вызывается и во время движения ползунков,
   поэтому здесь только смена стилей, без перерисовки страницы. */
function applyBackground() {
  const root = $('#appBg');
  const bg = state.settings && state.settings.background;
  if (!bg) return;
  document.body.classList.toggle('hero-flat', state.settings.heroBackground === false);
  const on = bg.mode !== 'none';
  document.body.classList.toggle('has-bg', on);
  root.classList.toggle('ready', on);
  if (!on) return;
  const url = bg.mode === 'custom' && state.wallpaper ? state.wallpaper : DEFAULT_WALLPAPER;
  const img = root.querySelector('.app-bg-img');
  img.style.backgroundImage = `url("${url}")`;
  img.style.filter = bg.blur ? `blur(${bg.blur}px)` : 'none';
  img.style.inset = `-${bg.blur * 2}px`; // запас по краям, чтобы размытие не светило пустотой
  root.querySelector('.app-bg-dim').style.opacity = String(bg.dim / 100);
}

async function loadSettings() {
  try {
    state.settings = await invoke('get_settings');
    if (state.settings.background.mode === 'custom') state.wallpaper = await invoke('get_wallpaper');
    state.sgdbKey = (await invoke('sgdb_state')).hasKey;
    state.trash = await invoke('list_trash');
  } catch (e) {
    toast(errText(e), 'error');
  }
  applyBackground();
  if (state.view === 'settings') render();
}

/* Сохраняет часть настроек. Если не вышло, возвращаем то, что реально записано. */
async function saveSettingsPatch(patch) {
  try {
    state.settings = await invoke('save_settings', { patch });
  } catch (e) {
    toast(errText(e), 'error');
    await loadSettings();
  }
  applyBackground();
}

async function pickWallpaper() {
  try {
    const picked = await dialog.open({
      title: 'Выберите картинку для фона',
      filters: [{ name: 'Картинки', extensions: IMAGE_EXTS }, { name: 'Все файлы', extensions: ['*'] }],
    });
    if (!picked) return;
    state.settings = await invoke('set_wallpaper', { path: picked });
    state.wallpaper = await invoke('get_wallpaper');
  } catch (e) {
    toast(errText(e), 'error');
  }
  applyBackground();
  render();
}

async function clearWallpaper() {
  try {
    state.settings = await invoke('clear_wallpaper');
    state.wallpaper = null;
  } catch (e) {
    toast(errText(e), 'error');
  }
  applyBackground();
  render();
}

/* Переключатель «вкл / выкл». */
function toggle(value, onChange, disabled = false) {
  const input = h('input', { type: 'checkbox', onChange: (e) => onChange(e.target.checked) });
  input.checked = !!value;
  input.disabled = disabled;
  return h('label', { class: 'switch' + (disabled ? ' is-disabled' : '') }, input, h('span', { class: 'switch-knob' }));
}

/* Ползунок: во время движения меняем фон сразу, сохраняем, когда отпустили. */
function slider({ min, max, step = 1, value, unit, onLive, onSave }) {
  const label = h('span', { class: 's-value' }, `${value}${unit}`);
  const input = h('input', {
    class: 's-range', type: 'range', min: String(min), max: String(max), step: String(step), value: String(value),
    onInput: (e) => { const n = Number(e.target.value); label.textContent = `${n}${unit}`; onLive(n); },
    onChange: (e) => onSave(Number(e.target.value)),
  });
  return h('div', { class: 's-slider' }, input, label);
}

function appearancePanel() {
  const bg = state.settings && state.settings.background;
  if (!bg) return settingsCard('Фон приложения', 'Загрузка…');
  const modes = segmented(
    [['default', 'Стандартный'], ['custom', 'Своя картинка'], ['none', 'Без фона']],
    () => bg.mode,
    (mode) => {
      if (mode === 'custom' && !bg.file) { pickWallpaper(); return; } // сначала нужна картинка
      bg.mode = mode;
      applyBackground();
      render();
      saveSettingsPatch({ background: { mode } });
    });
  const rows = [settingRow('Фон', 'Картинка за интерфейсом', modes.node)];
  if (bg.mode === 'custom') {
    rows.push(settingRow('Своя картинка', 'PNG, JPG, WEBP, BMP или GIF до 40 МБ, GIF может быть анимированной. Лучше всего 1920×1080',
      h('div', { class: 's-buttons' },
        h('button', { class: 'btn ghost small', type: 'button', onClick: pickWallpaper }, icon('image'), bg.file ? 'Заменить' : 'Выбрать'),
        bg.file && h('button', { class: 'btn ghost small', type: 'button', onClick: clearWallpaper }, 'Убрать'))));
  }
  if (bg.mode !== 'none') {
    rows.push(
      settingRow('Размытие', 'Чем больше, тем мягче фон',
        slider({ min: 0, max: 40, value: bg.blur, unit: ' px',
          onLive: (n) => { bg.blur = n; applyBackground(); },
          onSave: (n) => saveSettingsPatch({ background: { blur: n } }) })),
      settingRow('Затемнение', 'Помогает читать названия игр на светлых картинках',
        slider({ min: 0, max: 90, value: bg.dim, unit: '%',
          onLive: (n) => { bg.dim = n; applyBackground(); },
          onSave: (n) => saveSettingsPatch({ background: { dim: n } }) })));
  }
  const heroCard = settingsCard('Верхний блок', 'Большой блок с последней игрой над списком',
    settingRow('Фон верхнего блока', 'Если выключить, название и кнопки лежат прямо на фоне приложения, без карточки',
      toggle(state.settings.heroBackground, (on) => {
        state.settings.heroBackground = on;
        applyBackground();
        saveSettingsPatch({ heroBackground: on });
      })));
  return [settingsCard('Фон приложения', 'Картинка за всем интерфейсом', rows), heroCard];
}

async function pickJava() {
  try {
    const picked = await dialog.open({
      title: 'Укажите javaw.exe',
      filters: [{ name: 'Java', extensions: ['exe'] }, { name: 'Все файлы', extensions: ['*'] }],
    });
    if (!picked) return;
    state.settings.javaPath = picked;
    await saveSettingsPatch({ javaPath: picked });
  } catch (e) {
    toast(errText(e), 'error');
  }
  render();
}

async function clearJava() {
  state.settings.javaPath = '';
  await saveSettingsPatch({ javaPath: '' });
  render();
}

async function resetSettings() {
  const ok = await confirmModal({
    title: 'Сбросить настройки?',
    text: 'Фон, переключатели и путь к Java вернутся к значениям по умолчанию. Игры и библиотека не затрагиваются.',
    okLabel: 'Сбросить',
  });
  if (!ok) return;
  try {
    state.settings = await invoke('reset_settings');
    state.wallpaper = null;
    toast('Настройки сброшены');
  } catch (e) {
    toast(errText(e), 'error');
  }
  applyBackground();
  render();
}

function generalPanel() {
  ensureAppInfo();
  const st = state.settings;
  if (!st) return settingsCard('Общие настройки', 'Загрузка…');
  const packaged = !state.appInfo || state.appInfo.packaged;
  const rows = [
    settingRow('Запускать при старте системы',
      packaged ? 'ManyGameLib откроется сам после входа в Windows' : 'Работает только в собранном приложении, не при запуске через npm start',
      toggle(st.autostart && packaged, (on) => { st.autostart = on; render(); saveSettingsPatch({ autostart: on }); }, !packaged)),
    settingRow('Крестик окна', 'Что делать при закрытии окна. В трее приложение работает в фоне, открыть его можно значком возле часов',
      segmented(
        [['ask', 'Спрашивать'], ['tray', 'В трей'], ['quit', 'Закрывать']],
        () => st.closeAction,
        (v) => { st.closeAction = v; saveSettingsPatch({ closeAction: v }); },
      ).node),
    settingRow('Открываться в трее',
      packaged ? 'При запуске вместе с Windows окно не показывается, приложение ждёт в трее' : 'Работает только в собранном приложении, не при запуске через npm start',
      toggle(st.startMinimized && packaged, (on) => { st.startMinimized = on; saveSettingsPatch({ startMinimized: on }); }, !packaged || !st.autostart)),
    settingRow('Вести журнал', 'Запуски игр и ошибки записываются в файл logs\\manygamelib.log',
      toggle(st.logging, (on) => { st.logging = on; render(); saveSettingsPatch({ logging: on }); })),
  ];
  if (st.logging) {
    rows.push(settingRow('Папка журнала', 'Когда файл вырастает до 1 МБ, он становится manygamelib.log.old, а запись идёт в новый',
      h('button', { class: 'btn ghost small', type: 'button', onClick: () => openTarget('logs') }, icon('folder'), 'Открыть папку')));
  }
  return [
    settingsCard('Общие настройки', 'Основные параметры приложения', rows),
    settingsCard('Сброс', 'Вернуть настройки по умолчанию',
      settingRow('Сбросить настройки', 'Игры и библиотека не затрагиваются',
        h('button', { class: 'btn danger small', type: 'button', onClick: resetSettings }, 'Сбросить'))),
  ];
}

/* Ключ SteamGridDB: страница знает только «есть или нет». */
function sgdbRow() {
  const input = h('input', { class: 'input', type: 'password', placeholder: 'Вставьте ключ', autocomplete: 'off', spellcheck: false });
  const note = h('div', { class: 'form-error', hidden: true });
  const act = async (cmd, args) => {
    try {
      const res = await invoke(cmd, args);
      state.sgdbKey = res.hasKey;
      if (res.hasKey) toast(res.verified === false ? 'Ключ сохранён, но проверить его не удалось: нет связи с SteamGridDB.' : 'Ключ сохранён');
      render();
    } catch (e) { note.textContent = errText(e); note.hidden = false; }
  };
  const save = () => act('sgdb_set_key', { key: input.value });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  const link = h('button', { class: 'btn ghost small', type: 'button', onClick: () => invoke('open_external', { target: 'sgdb_key' }).catch((e) => toast(errText(e), 'error')) }, 'Где взять ключ');
  return settingRow('API-ключ',
    state.sgdbKey ? 'Сохранён на этом компьютере в зашифрованном виде' : 'Нужен для поиска обложек. Бесплатный, берётся в профиле на steamgriddb.com',
    h('div', {},
      state.sgdbKey
        ? h('div', { class: 's-buttons' }, h('button', { class: 'btn ghost small', type: 'button', onClick: () => act('sgdb_clear_key') }, 'Удалить ключ'))
        : h('div', { class: 's-buttons' }, input, h('button', { class: 'btn primary small', type: 'button', onClick: save }, 'Сохранить'), link),
      note));
}

let transferBusy = false;

/* Экспорт и импорт: окна выбора файла открывает главный процесс, страница путей не задаёт. */
async function transfer(kind) {
  if (transferBusy) return;
  transferBusy = true;
  if (state.view === 'settings') render();
  try {
    const res = await invoke(kind === 'export' ? 'export_library' : 'import_library');
    if (res && kind === 'export') {
      toast(`Сохранено игр: ${res.count}`);
    } else if (res) {
      let text = res.added || res.skipped ? `Добавлено ${res.added}, пропущено ${res.skipped}` : 'В архиве нет игр';
      if (res.imagesLost) text += `. Картинок не удалось перенести: ${res.imagesLost}`;
      toast(text);
      state.games = await invoke('get_games');
    }
  } catch (e) {
    toast(errText(e), 'error');
  }
  transferBusy = false;
  render();
}

/* Корзина на вкладке «Библиотека»: вернуть игру или удалить окончательно. */
function trashCard() {
  if (state.trash === null) {
    invoke('list_trash').then((t) => { state.trash = t; if (state.view === 'settings') render(); }).catch(() => { state.trash = []; });
  }
  const list = state.trash || [];
  if (!list.length) return null;
  const act = async (fn) => {
    try { await fn(); state.trash = await invoke('list_trash'); render(); } catch (e) { toast(errText(e), 'error'); }
  };
  const rows = list.map((t) => h('div', { class: 's-row' },
    h('div', { class: 's-text' }, h('b', {}, t.name || 'Без названия'),
      h('span', {}, `Убрана ${formatDate(t.deleted_at)}${t.playtime_sec > 0 ? `, наиграно ${formatHours(t.playtime_sec)}` : ''}`)),
    h('div', { class: 's-control' },
      h('div', { class: 's-buttons' },
        h('button', { class: 'btn ghost small', type: 'button', onClick: () => restoreGame(t.id) }, 'Вернуть'),
        h('button', { class: 'btn ghost small', type: 'button', onClick: () => act(() => invoke('delete_trash', { id: t.id })) }, 'Удалить навсегда')))));
  const clear = async () => {
    const ok = await confirmModal({
      title: 'Очистить корзину?',
      text: `Игры в корзине (${list.length}) и их картинки будут удалены окончательно. Сами игры на компьютере не затрагиваются.`,
      okLabel: 'Очистить',
    });
    if (ok) act(() => invoke('delete_trash', {}));
  };
  return settingsCard('Корзина', 'Убранные из библиотеки игры хранятся 30 дней, потом удаляются окончательно',
    ...rows,
    settingRow('Очистить корзину', null, h('button', { class: 'btn danger small', type: 'button', onClick: clear }, icon('trash'), 'Очистить')));
}

function libraryPanel() {
  ensureAppInfo();
  const total = state.games.length;
  const missing = state.games.filter((g) => g.missing).length;
  const dir = state.appInfo ? state.appInfo.dataDir : '…';
  return [
    settingsCard('Библиотека', 'Сколько игр и где лежат данные',
      settingRow('Игр в библиотеке', null, `${total}`),
      settingRow('Файл не найден', 'Игры, файлы которых переместили или удалили',
        h('span', { class: missing ? 's-bad' : '' }, `${missing}`)),
      settingRow('Папка данных', h('span', { class: 's-path', title: dir }, dir),
        h('button', { class: 'btn ghost small', type: 'button', onClick: () => openTarget('data') }, icon('folder'), 'Открыть папку'))),
    settingsCard('Запуск игр', 'Для файлов .jar',
      settingRow('Путь к Java',
        state.settings && state.settings.javaPath
          ? h('span', { class: 's-path', title: state.settings.javaPath }, state.settings.javaPath)
          : 'Не задан: Java ищется автоматически (PATH, JAVA_HOME, реестр, Program Files)',
        h('div', { class: 's-buttons' },
          h('button', { class: 'btn ghost small', type: 'button', onClick: pickJava }, 'Выбрать…'),
          state.settings && state.settings.javaPath && h('button', { class: 'btn ghost small', type: 'button', onClick: clearJava }, 'Сбросить')))),
    settingsCard('Перенос библиотеки', 'Сохранить игры в ZIP-архив и добавить их на другом компьютере',
      settingRow('Экспорт', 'Список игр, время в играх и все картинки в одном архиве',
        h('button', { class: 'btn ghost small', type: 'button', disabled: transferBusy || !total, onClick: () => transfer('export') }, icon('folder'), 'Экспортировать…')),
      settingRow('Импорт', 'Игры из архива добавляются к вашим, игры с тем же путём к файлу пропускаются. Открывайте только архивы, которым доверяете',
        h('button', { class: 'btn ghost small', type: 'button', disabled: transferBusy, onClick: () => transfer('import') }, icon('folder'), 'Импортировать…'))),
    trashCard(),
    settingsCard('SteamGridDB', 'Поиск обложек, баннеров и логотипов в форме игры, кнопка «Найти в SteamGridDB»',
      sgdbRow()),
    settingsCard('Защита данных', 'Список игр хранится безопасно',
      settingRow('Предыдущая версия списка', 'Файл games.json.bak, обновляется при каждом сохранении', null),
      settingRow('Копии за запуски', 'Папка backups: по одной копии за запуск, последние 5', null),
      settingRow('Если файл повредится', 'Он сохранится отдельно, а последняя рабочая копия восстановится сама', null)),
  ];
}

/* ---------- Обновления ---------- */

async function updateCommand(cmd) {
  try { state.update = await invoke(cmd) || state.update; } catch (e) { toast(errText(e), 'error'); }
  if (state.view === 'settings') render();
}

function updatesCard() {
  const u = state.update;
  const st = state.settings;
  if (!u || !st) return settingsCard('Обновления', 'Загрузка…');
  const installer = u.mode === 'installer';
  const sub = installer
    ? 'Новые версии берутся из GitHub Releases. Скачивание и установка только по вашей кнопке'
    : 'Портативная версия: приложение сообщит о новой версии, а скачать её нужно самому';
  const ver = u.version ? `v${u.version}` : '';
  const text = {
    idle: ['Проверка не выполнялась', `Сейчас v${u.current}`],
    checking: ['Проверяю…', null],
    none: ['У вас последняя версия', `v${u.current}`],
    available: [`Доступна версия ${ver}`, `Сейчас v${u.current}`],
    downloading: [`Скачиваю ${ver}…`, null],
    ready: [`Версия ${ver} скачана`, 'Приложение закроется, установит обновление и запустится снова'],
    error: ['Не удалось проверить обновления', u.error],
  }[u.status] || ['', null];
  const btn = (label, onClick, kind = 'ghost') => h('button', { class: `btn ${kind} small`, type: 'button', onClick }, label);
  let control;
  if (u.status === 'checking') control = btn('Проверяю…', () => {});
  else if (u.status === 'downloading') {
    control = h('div', { class: 's-progress-wrap' },
      h('div', { class: 's-progress' }, h('i', { id: 'updBar', style: `width:${u.progress}%` })),
      h('span', { class: 's-value', id: 'updPct' }, `${u.progress}%`));
  } else if (u.status === 'available') {
    control = installer ? btn('Скачать', () => updateCommand('download_update'), 'primary') : btn('Открыть страницу релиза', () => openTarget('release'), 'primary');
  } else if (u.status === 'ready') control = btn('Установить и перезапустить', () => updateCommand('install_update'), 'primary');
  else control = btn('Проверить', () => updateCommand('check_update'));
  if (u.status === 'checking') control.disabled = true;
  return settingsCard('Обновления', sub,
    settingRow(text[0], text[1], control),
    settingRow('Проверять при запуске', 'Один запрос к GitHub через несколько секунд после старта',
      toggle(st.checkUpdates, (on) => { st.checkUpdates = on; saveSettingsPatch({ checkUpdates: on }); })));
}

/* Состояние обновлений пришло из главного процесса. Во время скачивания двигаем только полоску,
   иначе страница перерисовывалась бы несколько раз в секунду. */
function onUpdateState(s) {
  const prev = state.update;
  state.update = s;
  if (s.status === 'available' && (!prev || prev.status !== 'available') && !(state.view === 'settings' && state.settingsTab === 'about')) {
    toast(`Доступна версия v${s.version}. Подробнее: Настройки → О приложении`);
  }
  const bar = $('#updBar');
  if (s.status === 'downloading' && prev && prev.status === 'downloading' && bar) {
    bar.style.width = `${s.progress}%`;
    const pct = $('#updPct');
    if (pct) pct.textContent = `${s.progress}%`;
    return;
  }
  if (state.view === 'settings' && state.settingsTab === 'about') render();
}

function aboutPanel() {
  ensureAppInfo();
  const i = state.appInfo;
  const v = (x) => (i ? x : '…');
  return [updatesCard(), settingsCard('ManyGameLib', 'Локальная библиотека игр для Windows',
    settingRow('Версия', null, v(i && `v${i.version}`)),
    settingRow('Electron', null, v(i && i.electron)),
    settingRow('Chromium', null, v(i && i.chrome)),
    settingRow('Node.js', null, v(i && i.node)),
    settingRow('Лицензия', null, v(i && i.license)),
    settingRow('Исходный код', 'Страница проекта на GitHub',
      h('button', { class: 'btn ghost small', type: 'button', onClick: () => openTarget('repo') }, 'Открыть на GitHub')))];
}

function renderSettings() {
  const tabs = h('nav', { class: 'settings-tabs' },
    SETTINGS_TABS.map((t) => h('button', {
      class: 'settings-tab' + (t.id === state.settingsTab ? ' active' : ''),
      type: 'button',
      onClick: () => { state.settingsTab = t.id; render(); },
    }, icon(t.icon), t.label)));
  const panel = h('div', { class: 'settings-panel' },
    state.settingsTab === 'about' ? aboutPanel()
      : state.settingsTab === 'library' ? libraryPanel()
      : state.settingsTab === 'appearance' ? appearancePanel() : generalPanel());
  return h('section', { class: 'section settings', style: 'margin-top:0' },
    h('div', { class: 'section-head' },
      h('div', {}, h('h2', {}, 'Настройки'), h('p', { class: 'settings-sub' }, 'Настройте приложение под себя'))),
    h('div', { class: 'settings-body' }, tabs, panel));
}

/* ---------- Карточки ---------- */

function activate(game, hero) {
  if (hero) selectGame(game.id, true); else openDetails(game.id);
}

/* Одиночный и двойной клик по плитке.
   В библиотеке (hero) клик сразу меняет верхний блок и подсветку, не перерисовывая плитки:
   иначе плитка под курсором заменилась бы и двойной клик пропал. Прокрутка вверх (она
   сдвигает плитки) ждёт CLICK_DELAY_MS и отменяется двойным кликом, который запускает игру.
   В остальных разделах одиночный клик открывает окно «Об игре», оно перекроет второй клик,
   поэтому там действие ждёт CLICK_DELAY_MS. */
const CLICK_DELAY_MS = 250;
let pendingClick = null; // { timer, run }

function flushPendingClick() {
  if (!pendingClick) return;
  const { timer, run } = pendingClick;
  clearTimeout(timer); pendingClick = null; run();
}

function cancelPendingClick() {
  if (pendingClick) { clearTimeout(pendingClick.timer); pendingClick = null; }
}

function schedule(run) {
  flushPendingClick(); // клик по другой плитке: предыдущее действие не теряем
  const job = { run: () => { pendingClick = null; run(); } };
  job.timer = setTimeout(job.run, CLICK_DELAY_MS);
  pendingClick = job;
}

/* Выбор игры без перерисовки всего экрана: меняем верхний блок и подсветку. */
function selectInPlace(id) {
  const game = state.games.find((g) => g.id === id);
  const heroEl = state.heroId && $('#content').firstElementChild;
  if (!game || !heroEl) { selectGame(id, false); return; }
  state.selectedId = id;
  const { candidates } = heroChoice();
  heroEl.replaceWith(renderHero(game, candidates));
  document.querySelectorAll('[data-game-id]').forEach((el) =>
    el.classList.toggle('selected', el.dataset.gameId === id));
  refreshLaunchButtons();
}

function clickHandlers(game, hero) {
  return {
    onClick: (e) => {
      if (e.detail > 1) return; // второй клик двойного: решит dblclick
      if (hero) {
        flushPendingClick();
        selectInPlace(game.id);
        schedule(() => $('#content').scrollTo({ top: 0, behavior: 'smooth' }));
      } else {
        schedule(() => openDetails(game.id));
      }
    },
    onDblclick: () => { cancelPendingClick(); launch(game.id); },
  };
}

/* С клавиатуры: Enter запускает игру, пробел делает то же, что клик. */
function cardKeys(game, hero) {
  return (e) => {
    if (e.target !== e.currentTarget) return; // вложенные кнопки обрабатывают себя сами
    if (e.key === 'Enter') { e.preventDefault(); launch(game.id); }
    else if (e.key === ' ') { e.preventDefault(); activate(game, hero); }
  };
}

function card(game, { chip = false, hero = false } = {}) {
  return h('div', {
    class: 'card' + (hero && game.id === state.selectedId ? ' selected' : ''),
    title: game.name,
    'data-game-id': game.id,
    tabindex: '0',
    role: 'button',
    ...clickHandlers(game, hero),
    onKeydown: cardKeys(game, hero),
    onContextmenu: (e) => openMenu(e, game),
  },
    h('div', { class: 'cover' + (game.missing ? ' missing' : '') },
      coverNode(game),
      game.missing && h('span', { class: 'miss-badge' }, 'Файл не найден'),
      game.favorite && h('span', { class: 'fav-badge', html: ICON.star }),
      chip && h('span', { class: 'chip' }, icon('clock'), formatLast(game.last_played)),
      h('button', {
        class: 'play-fab', title: 'Запустить', type: 'button', 'data-launch-id': game.id,
        onClick: (e) => { e.stopPropagation(); launch(game.id); },
        onDblclick: (e) => e.stopPropagation(),
      }, icon('play'))),
    h('div', { class: 'card-name' }, game.name));
}

function addTile() {
  return h('div', {
    class: 'card add', tabindex: '0', role: 'button', onClick: openAddModal,
    onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAddModal(); } },
  },
    h('div', { class: 'cover' }, icon('plus'), h('span', {}, 'Добавить игру')));
}

function row(game, hero) {
  return h('div', {
    class: 'row' + (hero && game.id === state.selectedId ? ' selected' : ''),
    'data-game-id': game.id,
    tabindex: '0',
    role: 'button',
    ...clickHandlers(game, hero),
    onKeydown: cardKeys(game, hero),
    onContextmenu: (e) => openMenu(e, game),
  },
    h('div', { class: 'thumb' }, coverNode(game)),
    h('div', { style: 'min-width:0' },
      h('div', { class: 'r-name' }, game.name),
      h('div', { class: 'r-path', title: game.exe_path }, game.missing ? 'Файл не найден — ' + game.exe_path : game.exe_path)),
    h('div', { class: 'r-time' }, formatLast(game.last_played)),
    h('button', { class: 'r-btn', type: 'button', title: 'Ещё', 'data-menu-trigger': true, onClick: (e) => { e.stopPropagation(); openMenu(e, game); } }, icon('more')),
    h('button', { class: 'r-btn play', type: 'button', title: 'Запустить', 'data-launch-id': game.id, onClick: (e) => { e.stopPropagation(); launch(game.id); } }, icon('play')));
}

/* ---------- Профиль ---------- */

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dayLabel = (key) => { const [, m, d] = key.split('-').map(Number); return `${d} ${MONTHS_GEN[m - 1]}`; };

/* Статистика берётся из журнала сессий; грузим при заходе на страницу и после каждой законченной игры. */
async function loadProfileData() {
  try {
    const [profile, stats] = await Promise.all([invoke('get_profile'), invoke('get_stats')]);
    state.profile = profile;
    state.stats = stats;
  } catch (e) {
    toast(errText(e), 'error');
  }
  if (state.view === 'profile') render();
}

async function pickAvatar() {
  try {
    const picked = await dialog.open({
      title: 'Выберите картинку для аватара',
      filters: [{ name: 'Картинки', extensions: IMAGE_EXTS }, { name: 'Все файлы', extensions: ['*'] }],
    });
    if (!picked) return;
    state.profile = await invoke('set_avatar', { path: picked });
  } catch (e) {
    toast(errText(e), 'error');
  }
  render();
}

async function clearAvatar() {
  try { state.profile = await invoke('clear_avatar'); } catch (e) { toast(errText(e), 'error'); }
  render();
}

async function saveNickname(value) {
  try { state.profile = { ...state.profile, ...(await invoke('set_nickname', { nickname: value })) }; } catch (e) { toast(errText(e), 'error'); }
  render();
}

function profileHead() {
  const p = state.profile;
  const name = p.nickname || 'Игрок';
  const avatar = p.avatar
    ? h('img', { class: 'pf-avatar', src: p.avatar, alt: '' })
    : h('div', { class: 'pf-avatar pf-avatar-ph', style: `--hue:${hueOf(name)}` }, (name.trim()[0] || '?').toUpperCase());

  const title = h('div', { class: 'pf-name' }, h('h2', {}, name),
    h('button', { class: 'icon-btn', type: 'button', title: 'Изменить ник', onClick: () => editNick(title, p.nickname) }, icon('edit')));
  return h('div', { class: 'pf-head' }, avatar,
    h('div', { class: 'pf-info' }, title,
      h('p', { class: 'pf-since' }, `В библиотеке с ${formatDate(p.created_at)}`),
      h('div', { class: 'pf-actions' },
        h('button', { class: 'btn small ghost', type: 'button', onClick: pickAvatar }, p.has_avatar ? 'Сменить аватар' : 'Выбрать аватар'),
        p.has_avatar && h('button', { class: 'btn small ghost', type: 'button', onClick: clearAvatar }, 'Убрать'))));
}

function editNick(host, current) {
  let done = false;
  const finish = (save) => { if (done) return; done = true; if (save) saveNickname(input.value); else render(); };
  const input = h('input', {
    class: 'input pf-nick-input', type: 'text', maxlength: '24', value: current || '', placeholder: 'Ваш ник',
    onKeydown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    },
    onBlur: () => finish(true),
  });
  host.replaceChildren(input);
  input.focus();
  input.select();
}

function statTile(label, value, hint) {
  return h('div', { class: 'pf-tile' }, h('b', {}, value), h('span', {}, label), hint && h('small', {}, hint));
}

function topGames() {
  const st = state.stats;
  const ranges = [['week', '7 дней'], ['month', '30 дней'], ['all', 'Всё время']];
  const body = h('div', { class: 'pf-top' });
  const draw = () => {
    const rows = st.top[state.topRange];
    body.replaceChildren();
    if (!rows.length) {
      body.append(h('p', { class: 'pf-empty' }, state.topRange === 'all'
        ? 'Пока никто не играл. Запустите игру из ManyGameLib, и здесь появится время.'
        : 'За этот период игр не было. Время по дням считается с момента, когда приложение начало записывать сессии.'));
      return;
    }
    const max = rows[0].sec || 1;
    rows.forEach((r, i) => body.append(h('div', { class: 'pf-row' },
      h('span', { class: 'pf-rank' }, String(i + 1)),
      h('div', { class: 'pf-bar-wrap' },
        h('div', { class: 'pf-row-top' }, h('span', { class: 'pf-gname' }, r.name), h('span', { class: 'pf-gtime' }, formatHours(r.sec))),
        h('div', { class: 'pf-bar' }, h('i', { style: `width:${Math.max(2, Math.round((r.sec / max) * 100))}%` }))))));
  };
  const seg = segmented(ranges, () => state.topRange, (v) => { state.topRange = v; draw(); });
  draw();
  return h('section', { class: 's-card pf-card' },
    h('div', { class: 's-card-head pf-card-head' }, h('div', {}, h('h3', {}, 'Топ игр'), h('p', {}, 'По времени в игре')), seg.node),
    body);
}

function dayChart() {
  const days = state.stats.days;
  const max = Math.max(...days.map((d) => d.sec), 1);
  const any = days.some((d) => d.sec > 0);
  return h('section', { class: 's-card pf-card' },
    h('div', { class: 's-card-head' }, h('h3', {}, 'Последние 30 дней'), h('p', {}, 'Сколько вы играли в каждый день')),
    any ? h('div', { class: 'pf-chart-wrap' },
      h('div', { class: 'pf-chart' }, days.map((d) => h('div', {
        class: 'pf-col', title: `${dayLabel(d.day)}: ${d.sec > 0 ? formatHours(d.sec) : 'не играли'}`,
      }, h('i', { style: `height:${d.sec > 0 ? Math.max(3, Math.round((d.sec / max) * 100)) : 0}%` })))),
      h('div', { class: 'pf-axis' }, h('span', {}, dayLabel(days[0].day)), h('span', {}, 'сегодня')))
      : h('p', { class: 'pf-empty' }, 'Пока нет записанных сессий. Играйте через ManyGameLib, и здесь появится график.'));
}

function renderProfile() {
  const section = h('section', { class: 'section pf', style: 'margin-top:0' });
  if (!state.profile || !state.stats) {
    section.append(h('div', { class: 'section-head' }, h('h2', {}, 'Профиль')), h('p', { class: 'pf-empty' }, 'Загрузка…'));
    return section;
  }
  const st = state.stats;
  section.append(profileHead(),
    h('div', { class: 'pf-tiles' },
      statTile('Всего наиграно', formatHours(st.total_sec)),
      statTile('Игр с временем', `${st.games_played} из ${st.games}`),
      statTile('За 7 дней', formatHours(st.week_sec)),
      statTile('За 30 дней', formatHours(st.month_sec)),
      statTile('Серия дней', String(st.streak_days), `лучшая: ${st.best_streak_days}`)),
    h('div', { class: 'pf-grid' }, topGames(), dayChart()));
  return section;
}

/* ---------- Навигация ---------- */

function setView(view) {
  state.view = view;
  if (view === 'profile') loadProfileData();
  state.query = '';
  cancelSearchDebounce();
  $('#search').value = '';
  render();
  $('#content').scrollTop = 0;
}

function setLayout(layout) {
  state.layout = layout;
  render();
}

function selectGame(id, scrollUp) {
  state.selectedId = id;
  render();
  if (scrollUp) $('#content').scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Контекстное меню ---------- */

let menuTrigger = null; // кнопка «⋯», которой открыто меню (повторный клик по ней закрывает меню)

function closeMenu() {
  const m = $('#menu');
  m.hidden = true;
  m.replaceChildren();
  menuTrigger = null;
}

function openMenu(e, game) {
  e.preventDefault();
  e.stopPropagation();
  const m = $('#menu');

  const trigger = e.type === 'click' ? e.currentTarget : null;
  if (trigger && menuTrigger === trigger && !m.hidden) { closeMenu(); return; }

  const item = (cls, ic, label, fn) =>
    h('button', { class: cls, type: 'button', onClick: () => { closeMenu(); fn(); } }, icon(ic), label);

  m.replaceChildren(
    game.running
      ? h('button', { class: 'is-running', type: 'button', disabled: true }, icon('play'), 'Играет')
      : item('', 'play', 'Запустить', () => launch(game.id)),
    item('', 'star', game.favorite ? 'Убрать из избранного' : 'В избранное', () => toggleFavorite(game.id)),
    item('', 'info', 'Подробнее', () => openDetails(game.id)),
    item('', 'edit', 'Изменить', () => openEditModal(game.id)),
    h('hr'),
    item('', 'folder', 'Показать в папке', () => invoke('show_in_folder', { id: game.id }).catch((e) => toast(errText(e), 'error'))),
    item('', 'copy', 'Копировать путь', () => invoke('copy_path', { id: game.id }).then(() => toast('Путь скопирован')).catch((e) => toast(errText(e), 'error'))),
    h('hr'),
    item('danger', 'trash', 'Убрать из библиотеки', () => removeGame(game.id)));
  m.hidden = false;
  menuTrigger = trigger;

  // Позиция: у курсора (или под кнопкой), но не за краем окна.
  const r = trigger ? trigger.getBoundingClientRect() : null;
  let x = r ? r.left : e.clientX;
  let y = r ? r.bottom + 6 : e.clientY;
  const { width, height } = m.getBoundingClientRect();
  x = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  y = Math.max(8, Math.min(y, window.innerHeight - height - 8));
  m.style.left = `${x}px`;
  m.style.top = `${y}px`;
}

document.addEventListener('mousedown', (e) => {
  if (!$('#menu').hidden && !e.target.closest('#menu') && !e.target.closest('[data-menu-trigger]')) closeMenu();
});
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.card, .row, input')) e.preventDefault();
});

/* ---------- Модальные окна ---------- */

let closeCurrent = null;
let currentGuard = null; // true, если в открытом окне есть несохранённые изменения

function closeModal() {
  if (closeCurrent) { closeCurrent(); closeCurrent = null; }
  currentGuard = null;
}

/* Закрытие по Esc или клику мимо. Если в форме есть введённые данные, не закрываем. */
function tryDismiss() {
  if (currentGuard && currentGuard()) {
    toast('В окне есть несохранённые данные. Если они не нужны, закройте окно крестиком.');
    return;
  }
  closeModal();
}

/* build(modal) может вернуть функцию-«охранник» (есть ли несохранённые данные). */
function openModal(build) {
  closeModal();
  const backdrop = h('div', { class: 'backdrop' });
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) tryDismiss(); });
  const guard = build(modal);
  backdrop.append(modal);
  $('#overlay').append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  closeCurrent = () => backdrop.remove();
  currentGuard = typeof guard === 'function' ? guard : null;
}

const modalHead = (title) =>
  h('div', { class: 'modal-head' },
    h('h3', {}, title),
    h('button', { class: 'x-btn', type: 'button', title: 'Закрыть', onClick: closeModal }, icon('close')));

/* opts.exe: файл, который уже выбран (перетащили в окно).
   opts.queue: { index, total, next }: файлов в очереди несколько, после этой игры открываем форму для следующей. */
function openAddModal(opts) {
  const exe = opts && typeof opts.exe === 'string' ? opts.exe : '';
  const queue = exe && opts.queue ? opts.queue : null;
  const more = !!queue && queue.index + 1 < queue.total;
  openModal((modal) => {
    modal.classList.add('wide');
    const form = gameForm({
      autofocus: true,
      initialExe: exe,
      onSkip: more ? () => { closeModal(); queue.next(); } : null,
      skipLabel: more ? `Пропустить (осталось ещё ${queue.total - queue.index - 1})` : 'Пропустить',
      onDone: (game) => {
        closeModal();
        upsert(game);
        state.selectedId = game.id;
        state.view = 'library';
        state.query = '';
        cancelSearchDebounce();
        $('#search').value = '';
        render();
        $('#content').scrollTop = 0;
        toast(`«${game.name}» добавлена в библиотеку`);
        if (more) queue.next();
      },
    });
    modal.append(modalHead(queue && queue.total > 1 ? `Добавить игру (${queue.index + 1} из ${queue.total})` : 'Добавить игру'), form);
    return form.isDirty;
  });
}

async function openEditModal(id) {
  const game = state.games.find((g) => g.id === id);
  if (!game) return;
  let assets;
  try {
    assets = await invoke('get_assets', { id });
  } catch (e) {
    toast(errText(e), 'error');
    return;
  }
  openModal((modal) => {
    modal.classList.add('wide');
    const form = gameForm({
      mode: 'edit',
      game,
      assets,
      onDone: (updated) => {
        closeModal();
        upsert(updated);
        delete state.assets[updated.id]; // картинки могли измениться, загрузим заново
        render();
        toast('Изменения сохранены');
      },
    });
    modal.append(modalHead('Изменить игру'), form);
    return form.isDirty;
  });
}

function openDetails(id) {
  const game = state.games.find((g) => g.id === id);
  if (!game) return;
  openModal((modal) => {
    modal.append(
      modalHead('Об игре'),
      h('div', { class: 'detail-top' },
        h('div', { class: 'detail-icon' }, coverNode(game)),
        h('div', { style: 'min-width:0' },
          h('div', { class: 'detail-name' }, game.name),
          h('div', { class: 'detail-last' },
            game.last_played ? `Запускали: ${formatLast(game.last_played).toLowerCase()}` : 'Ещё не запускалась'))),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Файл игры'),
        h('dd', { class: 'mono' + (game.missing ? ' bad' : '') }, game.exe_path + (game.missing ? '  (не найден)' : '')),
        ...(game.args ? [h('dt', {}, 'Параметры'), h('dd', { class: 'mono' }, game.args)] : []),
        h('dt', {}, 'Наиграно'),
        h('dd', {}, game.playtime_sec > 0 ? formatHours(game.playtime_sec) : '—'),
        h('dt', {}, 'Добавлена'),
        h('dd', {}, formatDate(game.added_at)),
        ...((game.tags || []).length ? [h('dt', {}, 'Теги'), h('dd', { class: 'tag-row' }, (game.tags).map((t) => h('span', { class: 'tag-pill' }, t)))] : []),
        h('dt', {}, 'Избранное'),
        h('dd', {}, game.favorite ? 'Да' : 'Нет')),
      h('div', { class: 'modal-actions split' },
        h('button', { class: 'btn danger small', type: 'button', onClick: () => { closeModal(); removeGame(game.id); } }, icon('trash'), 'Убрать'),
        h('div', { style: 'display:flex;gap:10px' },
          h('button', { class: 'btn ghost small', type: 'button', onClick: () => { closeModal(); openEditModal(game.id); } }, icon('edit'), 'Изменить'),
          h('button', {
            class: 'btn ghost small sq' + (game.favorite ? ' fav-on' : ''), type: 'button',
            title: game.favorite ? 'Убрать из избранного' : 'В избранное',
            onClick: () => { closeModal(); toggleFavorite(game.id); },
          }, icon('star')),
          h('button', { class: 'btn primary small', type: 'button', 'data-launch-id': game.id, onClick: () => { closeModal(); launch(game.id); } },
            icon('play'), h('span', { class: 'btn-label' }, 'Запустить')))));
  });
}

function confirmModal({ title, text, okLabel }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openModal((modal) => {
      modal.style.maxWidth = '440px';
      modal.append(
        h('div', { class: 'modal-head' }, h('h3', {}, title)),
        h('p', {}, text),
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn ghost small', type: 'button', onClick: () => { finish(false); closeModal(); } }, 'Отмена'),
          h('button', { class: 'btn danger small', type: 'button', onClick: () => { finish(true); closeModal(); } }, okLabel)));
    });
    // Закрытие по Esc/клику мимо тоже означает «отмена».
    const prev = closeCurrent;
    closeCurrent = () => { prev(); finish(false); };
  });
}

/* ---------- Мелкие элементы формы ---------- */

/* Переключатель из нескольких вариантов. */
function segmented(options, get, set) {
  const btns = options.map(([value, label]) =>
    h('button', { type: 'button', onClick: () => { set(value); sync(); } }, label));
  const node = h('div', { class: 'opts' }, btns);
  function sync() { btns.forEach((b, i) => b.classList.toggle('on', options[i][0] === get())); }
  sync();
  return { node, sync };
}

/* Флажок. */
function checkbox(label, get, set) {
  const input = h('input', { type: 'checkbox', onChange: (e) => set(e.target.checked) });
  const node = h('label', { class: 'check' }, input, h('span', {}, label));
  const sync = () => { input.checked = !!get(); };
  sync();
  return { node, sync };
}

const field = (label, ...kids) =>
  h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), ...kids);

/* ---------- Поиск картинок в SteamGridDB ---------- */

/* Пока открыта панель поиска, Esc закрывает её, а не всё окно. */
let escHook = null;

const SGDB_TABS = [
  { key: 'cover', label: 'Обложка', target: 'icon', wide: false },
  { key: 'banner', label: 'Баннер', target: 'banner', wide: true },
  { key: 'logo', label: 'Логотип', target: 'logo', wide: false },
  { key: 'icon', label: 'Иконка', target: 'icon', wide: false },
];
const SGDB_PICKED = { cover: 'Обложка выбрана', banner: 'Баннер выбран', logo: 'Логотип выбран', icon: 'Иконка выбрана' };

/* Панель встаёт на место формы внутри того же окна. onPick(target, path, url): как после кнопки «Обзор…». */
function openSgdbPanel({ host, form, name, onPick }) {
  const view = { game: null, tab: 'cover', games: [], cache: new Map(), busy: false };
  const body = h('div', { class: 'sg-body' });
  const close = () => { panel.remove(); form.hidden = false; escHook = null; };
  const panel = h('div', { class: 'sg-panel' },
    h('div', { class: 'sg-head' },
      h('h4', {}, 'Поиск в SteamGridDB'),
      h('button', { class: 'btn ghost small', type: 'button', onClick: close }, 'Назад к форме')),
    body);
  form.hidden = true;
  host.append(panel);
  escHook = () => { close(); return true; };

  const fail = (e) => { body.querySelector('.sg-results')?.replaceChildren(h('div', { class: 'form-error' }, errText(e))); };

  /* --- Ключ --- */
  function keyScreen(message) {
    const input = h('input', { class: 'input', type: 'password', placeholder: 'API-ключ SteamGridDB', autocomplete: 'off', spellcheck: false });
    const err = h('div', { class: 'form-error', hidden: true });
    const save = async () => {
      err.hidden = true;
      try {
        const res = await invoke('sgdb_set_key', { key: input.value });
        input.value = '';
        state.sgdbKey = true;
        if (!res.verified) toast('Ключ сохранён, но проверить его не удалось: нет связи с SteamGridDB.');
        mainScreen();
      } catch (e) { err.textContent = errText(e); err.hidden = false; }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    body.replaceChildren(
      h('p', { class: 'hint' }, message || 'Для поиска нужен ваш личный ключ SteamGridDB. Он бесплатный: зарегистрируйтесь на сайте и скопируйте ключ из профиля («Preferences → API»). Ключ хранится только на этом компьютере, в зашифрованном виде.'),
      h('div', { class: 'pick-row' }, input, h('button', { class: 'btn primary small', type: 'button', onClick: save }, 'Сохранить')),
      err,
      h('button', { class: 'btn ghost small', type: 'button', onClick: () => invoke('open_external', { target: 'sgdb_key' }).catch((e) => toast(errText(e), 'error')) }, 'Открыть страницу с ключом'));
    setTimeout(() => input.focus(), 30);
  }

  /* --- Поиск и картинки --- */
  const queryInput = h('input', { class: 'input', type: 'text', value: name || '', placeholder: 'Название игры', spellcheck: false });
  const gamesBox = h('div', { class: 'sg-games' });
  const tabsBox = h('div', { class: 'sg-tabs' });
  const results = h('div', { class: 'sg-results' });

  function renderGames() {
    gamesBox.replaceChildren(...view.games.map((g) => h('button', {
      type: 'button', class: `sg-chip${view.game && view.game.id === g.id ? ' active' : ''}`, onClick: () => selectGame(g),
    }, g.name)));
  }
  function renderTabs() {
    tabsBox.replaceChildren(...SGDB_TABS.map((t) => h('button', {
      type: 'button', class: `sg-tab${view.tab === t.key ? ' active' : ''}`, onClick: () => { view.tab = t.key; renderTabs(); loadImages(); },
    }, t.label)));
  }

  async function search() {
    const term = queryInput.value.trim();
    if (!term) { results.replaceChildren(h('div', { class: 'hint' }, 'Введите название игры и нажмите «Найти».')); return; }
    results.replaceChildren(h('div', { class: 'hint' }, 'Ищу…'));
    try {
      view.games = await invoke('sgdb_search', { term });
      view.game = null;
      renderGames();
      if (!view.games.length) { results.replaceChildren(h('div', { class: 'hint' }, 'Ничего не найдено. Попробуйте другое название.')); return; }
      selectGame(view.games[0]);
    } catch (e) { handleError(e); }
  }

  function handleError(e) {
    if (e && /NO_KEY|API-ключ|не принял ключ/.test(String(e.message || e))) {
      state.sgdbKey = false; keyScreen(/не принял/.test(String(e.message || e)) ? 'SteamGridDB не принял ключ. Вставьте другой.' : ''); return; }
    fail(e);
  }

  function selectGame(g) { view.game = g; renderGames(); loadImages(); }

  async function loadImages() {
    if (!view.game) return;
    const id = view.game.id;
    const tab = SGDB_TABS.find((t) => t.key === view.tab);
    const ck = `${id}:${tab.key}`;
    results.replaceChildren(h('div', { class: 'hint' }, 'Загружаю…'));
    try {
      let list = view.cache.get(ck);
      if (!list) { list = await invoke('sgdb_images', { gameId: id, kind: tab.key }); view.cache.set(ck, list); }
      if (!view.game || view.game.id !== id || view.tab !== tab.key) return;   // пока грузили, выбрали другое
      if (!list.length) { results.replaceChildren(h('div', { class: 'hint' }, 'Для этой игры тут ничего нет.')); return; }
      results.replaceChildren(h('div', { class: `sg-grid${tab.wide ? ' wide' : ''}` }, ...list.map((it) => h('button', {
        type: 'button', class: 'sg-thumb', title: it.width && it.height ? `${it.width}×${it.height}` : '', onClick: () => choose(it, tab),
      }, h('img', { src: it.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }),
        it.width && it.height ? h('span', { class: 'sg-size' }, `${it.width}×${it.height}`) : null))));
    } catch (e) { handleError(e); }
  }

  async function choose(it, tab) {
    if (view.busy) return;
    view.busy = true;
    results.classList.add('busy');
    try {
      const got = await invoke('sgdb_download', { url: it.url });
      onPick(tab.target, got.path, got.url);
      toast(SGDB_PICKED[tab.key]);
      close();
    } catch (e) {
      results.classList.remove('busy');
      toast(errText(e), 'error');
    }
    view.busy = false;
  }

  function mainScreen() {
    body.replaceChildren(
      h('div', { class: 'pick-row' }, queryInput, h('button', { class: 'btn primary small', type: 'button', onClick: search }, 'Найти')),
      gamesBox, tabsBox, results,
      h('p', { class: 'hint sg-credit' }, 'Картинки с SteamGridDB (steamgriddb.com). Выбранная картинка копируется в вашу библиотеку.'));
    queryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    renderTabs();
    search();
  }

  invoke('sgdb_state').then((st) => (st.hasKey ? mainScreen() : keyScreen())).catch((e) => body.replaceChildren(h('div', { class: 'form-error' }, errText(e))));
}

/* ---------- Форма добавления и изменения игры ---------- */

const PICK_TITLES = {
  icon: 'Выберите иконку или обложку игры',
  banner: 'Выберите баннер для верхнего блока',
  logo: 'Выберите логотип игры',
};

function gameForm({ mode = 'add', game = null, assets = null, onDone, autofocus = false, initialExe = '', onSkip = null, skipLabel = 'Пропустить' }) {
  const editing = mode === 'edit';

  const st = {
    name: game ? game.name : '',
    exe: game ? game.exe_path : '',
    args: game ? game.args || '' : '',
    playtime: game && game.playtime_sec > 0 ? String(Math.round(game.playtime_sec / 36) / 100).replace('.', ',') : '',   // часы, до сотых
    playtimeTouched: false,
    tags: game ? [...(game.tags || [])] : [],
    nameTouched: editing,
    iconTouched: false,   // пользователь сам выбирал или убирал иконку: автоиконку из файла больше не подставляем
    hero: { ...DEFAULT_HERO, ...(game ? game.hero : {}) },
    // url — что показываем сейчас; mode и path — что сделать при сохранении:
    // keep (оставить как есть), set (взять файл path), clear (убрать).
    img: {
      icon: { url: assets ? assets.icon : null, mode: 'keep', path: '' },
      banner: { url: assets ? assets.banner : null, mode: 'keep', path: '' },
      logo: { url: assets ? assets.logo : null, mode: 'keep', path: '' },
    },
    busy: false,
  };
  // Были ли картинки у игры до правки (нужно, чтобы понять, что именно удалять).
  const had = { icon: !!st.img.icon.url, banner: !!st.img.banner.url, logo: !!st.img.logo.url };

  const error = h('div', { class: 'form-error', hidden: true });
  const showError = (msg) => { error.textContent = msg; error.hidden = !msg; };

  /* --- Путь и название --- */

  const exeInput = h('input', {
    class: 'input', type: 'text', readonly: true, placeholder: 'C:\\Games\\Game\\game.exe',
    onClick: pickExe,
  });
  exeInput.value = st.exe;

  const nameInput = h('input', {
    class: 'input', type: 'text', maxlength: '80', placeholder: 'Например, Elden Ring', spellcheck: 'false',
    onInput: (e) => { st.name = e.target.value; st.nameTouched = true; updatePreview(); },
  });
  nameInput.value = st.name;

  // Время в игре, часы. Если пользователь поле не трогал, время не отправляем: автоучёт не затирается округлением.
  const playtimeInput = h('input', {
    class: 'input', type: 'text', inputmode: 'decimal', maxlength: '9', placeholder: '0', autocomplete: 'off',
    onInput: (e) => { st.playtime = e.target.value; st.playtimeTouched = true; },
  });
  playtimeInput.value = st.playtime;
  const playtimeField = field('Наиграно, ч',
    playtimeInput,
    h('span', { class: 'hint' }, 'Считается само, пока запущенная игра работает (запуски короче минуты не в счёт). Здесь можно задать своё значение, например 12,5.'));

  // Параметры запуска: поле видно только для файлов, которым main.js их передаёт (exe, com, jar).
  const ARGS_TYPES = ['exe', 'com', 'jar'];
  const argsInput = h('input', {
    class: 'input', type: 'text', maxlength: '1000', spellcheck: 'false', placeholder: '-windowed -nolauncher',
    onInput: (e) => { st.args = e.target.value; },
  });
  argsInput.value = st.args;
  const argsField = field('Параметры запуска',
    argsInput,
    h('span', { class: 'hint' }, 'Необязательно. Через пробел, значения с пробелами в кавычках. Для .jar они идут после -jar.'));
  function syncArgs() {
    const ext = (st.exe.split('.').pop() || '').toLowerCase();
    argsField.hidden = !ARGS_TYPES.includes(ext);
  }
  syncArgs();

  async function pickExe() {
    try {
      const picked = await dialog.open({
        title: 'Выберите файл запуска игры',
        filters: [
          { name: 'Игры и программы', extensions: ['exe', 'jar', 'bat', 'cmd', 'lnk', 'url', 'com', 'msi'] },
          { name: 'Все файлы', extensions: ['*'] },
        ],
      });
      if (picked) applyExe(picked);
    } catch (e) {
      showError(errText(e));
    }
  }

  /* Файл игры выбран (диалогом или перетаскиванием): подставляем всё, что можно вывести из него. */
  function applyExe(picked) {
    st.exe = picked;
    exeInput.value = picked;
    syncArgs();
    syncFromFile();
    autoIcon();
    showError('');
    if (!st.nameTouched || !st.name.trim()) {
      const parts = picked.split(/[\\/]/).filter(Boolean);
      const file = (parts.pop() || '').replace(/\.[^.]+$/, ''); // «расширение» срезаем только у файла
      let guess = file;
      // У exe часто общее имя (launcher, game…): тогда берём название папки игры как есть.
      if (/^(launcher|game|start|play|run|main|app|bin|client|win64|shipping)$/i.test(file) && parts.length) {
        guess = parts.pop();
      }
      st.name = guess.replace(/_+/g, ' ').trim();
      nameInput.value = st.name;
    }
    updatePreview();
  }

  /* --- Картинки --- */

  function imageRow(kind, placeholder) {
    const input = h('input', {
      class: 'input', type: 'text', readonly: true, placeholder, onClick: () => pickImage(kind),
    });
    const clear = h('button', {
      class: 'btn ghost small sq', type: 'button', title: 'Убрать', onClick: () => setImage(kind, null),
    }, icon('close'));
    const row = h('div', { class: 'pick-row' },
      input,
      h('button', { class: 'btn ghost small', type: 'button', onClick: () => pickImage(kind) }, 'Обзор…'),
      clear);
    const sync = () => {
      const im = st.img[kind];
      input.value = im.mode === 'exe' ? 'Иконка из файла' : im.path || (im.url ? 'Текущая картинка' : '');
      clear.hidden = !im.url;
    };
    return { row, sync };
  }

  const iconRow = imageRow('icon', 'PNG, JPG, ICO… (необязательно)');
  // Иконка из самого файла игры. Сама подставляется только при добавлении и только для exe и lnk.
  const ICON_TYPES = ['exe', 'com', 'lnk', 'url'];
  const AUTO_ICON_TYPES = ['exe', 'lnk'];
  const extOfExe = () => (st.exe.split('.').pop() || '').toLowerCase();
  async function fromFile(auto) {
    const file = st.exe;
    try {
      const url = await invoke('file_icon', { path: file });
      if (file !== st.exe) return;   // за это время выбрали другой файл
      if (!url) { if (!auto) showError('Не удалось получить иконку из файла.'); return; }
      Object.assign(st.img.icon, { url, mode: 'exe', path: '' });
      if (!auto) st.iconTouched = true;
      showError('');
      syncImages();
      updatePreview();
    } catch (e) {
      if (!auto) showError(errText(e));
    }
  }
  const fromFileBtn = h('button', {
    class: 'btn ghost small', type: 'button', title: 'Взять иконку из самого файла игры', onClick: () => fromFile(false),
  }, 'Из файла');
  function syncFromFile() { fromFileBtn.hidden = !ICON_TYPES.includes(extOfExe()); }
  function autoIcon() {
    const im = st.img.icon;
    const ext = extOfExe();
    if (im.mode === 'exe' && !AUTO_ICON_TYPES.includes(ext)) { setAutoClear(); return; }   // файл сменили на другой тип: автоиконка не подходит
    if (editing || st.iconTouched || !AUTO_ICON_TYPES.includes(ext)) return;
    if (im.mode === 'exe' || (im.mode === 'keep' && !im.url)) fromFile(true);
  }
  function setAutoClear() {
    Object.assign(st.img.icon, { url: null, mode: had.icon ? 'clear' : 'keep', path: '' });
    syncImages();
    updatePreview();
  }

  const sgdbBtn = h('button', {
    class: 'btn ghost small sg-find', type: 'button', title: 'Найти обложку, баннер и логотип в SteamGridDB',
    onClick: () => {
      const host = form.closest('.modal');
      if (!host) return;
      openSgdbPanel({
        host, form, name: st.name.trim(),
        onPick: (target, path, url) => setImage(target, path, url),
      });
    },
  }, icon('image'), 'Найти в SteamGridDB');

  /* --- Теги --- */
  const tagList = h('div', { class: 'tag-chips' });
  const tagInput = h('input', { class: 'tag-input', type: 'text', placeholder: 'Добавить тег…', maxlength: MAX_TAG_LEN * 2, list: 'tagSuggest', spellcheck: false, autocomplete: 'off' });
  const tagSuggest = h('datalist', { id: 'tagSuggest' }, allTags().map((t) => h('option', { value: t.name })));
  function syncTags() {
    tagList.replaceChildren(
      ...st.tags.map((t) => h('span', { class: 'tag-pill removable' }, t,
        h('button', { class: 'tag-x', type: 'button', title: 'Убрать тег', onClick: () => { st.tags = st.tags.filter((x) => x !== t); syncTags(); } }, icon('close')))),
      tagInput);
  }
  function addTags(text) {
    for (const part of String(text).split(',')) {
      const tag = part.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LEN).trim();
      if (!tag || st.tags.some((x) => tagKey(x) === tagKey(tag))) continue;
      if (st.tags.length >= MAX_TAGS) { showError(`Не больше ${MAX_TAGS} тегов на игру.`); break; }
      st.tags.push(tag);
    }
    tagInput.value = '';
    syncTags();
  }
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTags(tagInput.value); tagInput.focus(); }
    else if (e.key === 'Backspace' && !tagInput.value && st.tags.length) { st.tags.pop(); syncTags(); tagInput.focus(); }
  });
  tagInput.addEventListener('blur', () => { if (tagInput.value.trim()) addTags(tagInput.value); });

  const bannerRow = imageRow('banner', 'Широкая картинка, например 1920×620');
  const logoRow = imageRow('logo', 'PNG с прозрачным фоном (необязательно)');
  iconRow.row.insertBefore(fromFileBtn, iconRow.row.lastElementChild);

  const iconPick = h('button', {
    class: 'icon-pick', type: 'button', title: 'Выбрать иконку', onClick: () => pickImage('icon'),
  });

  function syncImages() {
    iconRow.sync();
    bannerRow.sync();
    logoRow.sync();
    const u = st.img.icon.url;
    iconPick.classList.toggle('filled', !!u);
    iconPick.replaceChildren(u ? h('img', { src: u, alt: '' }) : icon('image'));
  }

  function setImage(kind, path, url) {
    const im = st.img[kind];
    if (kind === 'icon') st.iconTouched = true;
    if (path) {
      im.path = path; im.url = url; im.mode = 'set';
    } else {
      im.path = ''; im.url = null; im.mode = had[kind] ? 'clear' : 'keep';
    }
    if (kind === 'banner') {
      // Выбрал баннер — логично показать его фоном; убрал — вернуть размытую обложку.
      if (path) st.hero.bg = 'banner';
      else if (st.hero.bg === 'banner') st.hero.bg = 'blur';
      syncHero();
    }
    syncImages();
    updatePreview();
  }

  async function pickImage(kind) {
    try {
      const picked = await dialog.open({
        title: PICK_TITLES[kind],
        filters: [{ name: 'Изображения', extensions: IMAGE_EXTS }],
      });
      if (!picked) return;
      const url = await invoke('preview_image', { path: picked });
      setImage(kind, picked, url);
      showError('');
    } catch (e) {
      showError(errText(e));
    }
  }

  /* --- Верхний блок --- */

  const previewBox = h('div', { class: 'hero-preview' });

  function updatePreview() {
    const spec = {
      name: st.name.trim() || 'Название игры',
      exe_path: st.exe || 'C:\\Games\\Game\\game.exe',
      last_played: null,
      icon: st.img.icon.url,
      banner: st.img.banner.url,
      logo: st.img.logo.url,
      hero: st.hero,
    };
    previewBox.replaceChildren(h('div', { class: 'hero-preview-inner' }, heroNode(spec, { preview: true })));
  }

  const bgSeg = segmented(
    [['blur', 'Размытая обложка'], ['banner', 'Свой баннер'], ['color', 'Цвет']],
    () => st.hero.bg,
    (v) => { st.hero.bg = v; syncHero(); updatePreview(); });
  const artCheck = checkbox('Показывать обложку справа', () => st.hero.art,
    (v) => { st.hero.art = v; syncHero(); updatePreview(); });
  const fitSeg = segmented(
    [['cover', 'Обрезать по рамке'], ['contain', 'Показать целиком']],
    () => st.hero.fit,
    (v) => { st.hero.fit = v; updatePreview(); });

  const bannerField = field('Картинка баннера', bannerRow.row);

  function syncHero() {
    bgSeg.sync();
    artCheck.sync();
    fitSeg.sync();
    bannerField.hidden = st.hero.bg !== 'banner';
    fitSeg.node.hidden = !st.hero.art;
  }

  /* --- Сохранение --- */

  const submitBtn = h('button', { class: 'btn primary wide', type: 'submit' }, editing ? 'Сохранить' : 'Добавить игру');

  const form = h('form', { class: 'form', novalidate: true, onSubmit: async (e) => {
    e.preventDefault();
    if (st.busy) return;
    if (!st.exe) return showError('Выберите файл, которым запускается игра.');
    if (!st.name.trim()) { nameInput.focus(); return showError('Введите название игры.'); }
    if (st.hero.bg === 'banner' && !st.img.banner.url) {
      return showError('Выберите картинку для баннера или другой фон верхнего блока.');
    }

    let playtimeSec;
    if (st.playtimeTouched) {
      const text = st.playtime.trim().replace(',', '.');
      const hours = text === '' ? 0 : Number(text);
      if (!Number.isFinite(hours) || hours < 0 || hours > 100000) {
        playtimeInput.focus();
        return showError('Наиграно: введите число часов, например 12,5.');
      }
      playtimeSec = Math.round(hours * 3600);
    }

    const payload = {
      name: st.name.trim(),
      exePath: st.exe,
      args: argsField.hidden ? '' : st.args.trim(),
      playtimeSec,
      hero: { ...st.hero },
      tags: [...st.tags],
      images: Object.fromEntries(Object.entries(st.img).map(([k, v]) => [k, { mode: v.mode, path: v.path }])),
    };

    st.busy = true;
    submitBtn.disabled = true;
    showError('');
    try {
      const saved = editing
        ? await invoke('update_game', { id: game.id, ...payload })
        : await invoke('add_game', payload);
      onDone(saved);
    } catch (err) {
      showError(errText(err));
      st.busy = false;
      submitBtn.disabled = false;
    }
  } },
    field('Путь к игре',
      h('div', { class: 'pick-row' },
        exeInput,
        h('button', { class: 'btn ghost small', type: 'button', onClick: pickExe }, 'Обзор…'))),
    h('label', { class: 'field' },
      h('span', { class: 'field-label' }, 'Название'),
      nameInput),
    argsField,
    playtimeField,
    field('Иконка или обложка',
      h('div', { class: 'icon-row' },
        iconPick,
        h('div', { class: 'icon-side' },
          iconRow.row,
          h('span', { class: 'hint' }, 'Лучше всего квадрат 512×512 или вертикальная обложка 600×900. Для exe иконка берётся из самого файла, но она небольшая: своя картинка выглядит чётче. Без иконки будет цветная плитка с первой буквой.'),
          sgdbBtn))),
    field('Теги', h('div', { class: 'tag-box', onClick: () => tagInput.focus() }, tagList, tagSuggest),
      h('span', { class: 'hint' }, 'Например: Пройдено, В планах, Онлайн. Enter или запятая добавляют тег. По тегам можно фильтровать библиотеку в боковом меню.')),
    h('div', { class: 'hero-cfg' },
      h('div', { class: 'section-title' }, 'Верхний блок'),
      h('p', { class: 'hint' }, 'Так игра выглядит вверху библиотеки, когда она выбрана. Предпросмотр ниже обновляется сразу.'),
      previewBox,
      field('Фон', bgSeg.node),
      bannerField,
      field('Логотип вместо названия', logoRow.row),
      field('Обложка справа', h('div', { class: 'inline' }, artCheck.node, fitSeg.node))),
    error,
    submitBtn,
    ...(onSkip ? [h('button', { class: 'btn ghost wide', type: 'button', onClick: onSkip }, skipLabel)] : []));

  // Есть ли несохранённые данные (для защиты от случайного закрытия окна).
  const snap = () => JSON.stringify([
    st.name.trim(), st.exe, st.hero, st.playtime, st.tags,
    Object.values(st.img).map((v) => [v.mode === 'exe' && !st.iconTouched ? 'keep' : v.mode, v.path]), // автоиконку не считаем правкой
  ]);
  let initial = snap();
  form.isDirty = () => !st.busy && snap() !== initial;

  syncImages();
  syncTags();
  syncFromFile();
  syncHero();
  updatePreview();
  if (initialExe) { applyExe(initialExe); initial = snap(); }   // файл пришёл перетаскиванием: это не правка пользователя
  if (autofocus) setTimeout(() => (initialExe ? nameInput : exeInput).focus(), 60);
  return form;
}

/* ---------- Перетаскивание файлов в окно ---------- */

const DROP_TYPES = ['exe', 'jar', 'bat', 'cmd', 'lnk', 'url', 'com', 'msi'];
const DROP_MAX = 25;   // больше за раз не берём: каждому файлу открывается своя форма
const pathKeyUi = (p) => String(p).replace(/\//g, '\\').toLowerCase();

const dropOverlay = h('div', { class: 'drop-overlay', hidden: true },
  h('div', { class: 'drop-card' },
    h('div', { class: 'drop-title' }, 'Отпустите, чтобы добавить игру'),
    h('div', { class: 'drop-sub' }, 'Файлы .exe, .jar, .lnk и другие')));
document.body.append(dropOverlay);

let dragDepth = 0;
const dragHasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

window.addEventListener('dragenter', (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  dragDepth += 1;
  dropOverlay.hidden = false;
});
window.addEventListener('dragover', (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault();   // без этого окно попыталось бы открыть файл как страницу
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
  if (!dragHasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropOverlay.hidden = true;
});
window.addEventListener('drop', (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  handleDrop(Array.from(e.dataTransfer.files));
});

function handleDrop(files) {
  if (document.querySelector('#overlay .backdrop')) {
    toast('Сначала закройте открытое окно, затем перетащите файлы ещё раз.');
    return;
  }
  const have = new Set(state.games.map((g) => pathKeyUi(g.exe_path)));
  const queue = [];
  let unsupported = 0;
  const dups = [];
  for (const f of files) {
    const p = window.api.pathForFile(f);
    const ext = (p.split('.').pop() || '').toLowerCase();
    if (!p || !DROP_TYPES.includes(ext) || /[\\/]$/.test(p)) { unsupported += 1; continue; }
    const key = pathKeyUi(p);
    if (have.has(key)) { dups.push(p.split(/[\\/]/).pop()); continue; }
    have.add(key);   // один и тот же файл дважды в одной пачке
    queue.push(p);
  }
  const notes = [];
  if (dups.length) notes.push(dups.length === 1 ? `«${dups[0]}» уже в библиотеке` : `уже в библиотеке: ${dups.length}`);
  if (unsupported) notes.push(`не подходит по типу: ${unsupported}`);
  if (queue.length > DROP_MAX) { notes.push(`взяты первые ${DROP_MAX}`); queue.length = DROP_MAX; }
  if (!queue.length) {
    toast(notes.length ? `Нечего добавлять (${notes.join(', ')}).${unsupported ? ' Подходят .exe, .jar, .lnk, .url, .bat, .cmd, .com, .msi.' : ''}` : 'Нечего добавлять.');
    return;
  }
  if (notes.length) toast(`Пропущено: ${notes.join(', ')}`);
  const next = (i) => {
    if (i < queue.length) openAddModal({ exe: queue[i], queue: { index: i, total: queue.length, next: () => next(i + 1) } });
  };
  next(0);
}

/* ---------- Окно: кнопки и состояние ---------- */

const MAX_ICON = '<svg viewBox="0 0 12 12"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1"/></svg>';
const RESTORE_ICON = '<svg viewBox="0 0 12 12"><rect x="2.2" y="3.8" width="6" height="6" rx="1"/><path d="M4 3.8V2.8a.8.8 0 0 1 .8-.8h4.4a.8.8 0 0 1 .8.8v4.4a.8.8 0 0 1-.8.8H8.2"/></svg>';

function setMaximized(maximized) {
  const btn = $('#wMax');
  btn.innerHTML = maximized ? RESTORE_ICON : MAX_ICON;
  btn.title = maximized ? 'Восстановить' : 'Развернуть';
}

/* ---------- Старт ---------- */

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeMenu(); if (escHook && escHook()) return; tryDismiss(); }
});

$('#nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (btn) setView(btn.dataset.view);
});

/* Поиск перерисовывает весь экран, поэтому ждём паузу в наборе, а не реагируем на каждую букву. */
const SEARCH_DEBOUNCE_MS = 150;
let searchTimer = null;

function cancelSearchDebounce() {
  clearTimeout(searchTimer);
  searchTimer = null;
}

$('#search').addEventListener('input', () => {
  cancelSearchDebounce();
  searchTimer = setTimeout(() => {
    searchTimer = null;
    const q = $('#search').value;
    if (q === state.query) return;
    state.query = q;
    render();
  }, SEARCH_DEBOUNCE_MS);
});

$('#wMin').addEventListener('click', () => appWindow.minimize());
$('#wMax').addEventListener('click', () => appWindow.toggleMaximize());
$('#wClose').addEventListener('click', () => appWindow.close());

window.api.onWinState(setMaximized);
// Время в игре изменилось (игра закрылась): обновляем игру и перерисовываем экран.
window.api.onGameUpdated((g) => { upsert(g); if (state.view === 'profile') loadProfileData(); render(); });
window.api.onUpdateState(onUpdateState);
invoke('get_update_state').then((s) => { state.update = s; }).catch(() => {});
invoke('win_state').then(setMaximized).catch(() => {});
invoke('get_version').then((v) => { $('.brand-text small').textContent = `v${v}`; }).catch(() => {});
window.addEventListener('focus', syncMissing);
// Выбор в диалоге закрытия («Запомнить выбор») меняет настройку в фоне: подтянем её, если открыты настройки.
window.addEventListener('focus', () => { if (state.view === 'settings') loadSettings(); });

refresh();
loadSettings();
