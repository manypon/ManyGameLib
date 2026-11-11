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
  view: 'library',      // library | favorites | recent | settings
  query: '',
  sort: 'name',         // name | added | played
  layout: 'grid',       // grid | list
  selectedId: null,
  settingsTab: 'appearance', // вкладка страницы настроек: appearance | library | about
  appInfo: null,        // сведения о приложении для вкладки «О приложении»
  settings: null,       // настройки приложения (get_settings)
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

function toast(msg, type = 'ok') {
  const t = h('div', { class: `toast ${type}` }, msg);
  $('#toasts').append(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 220);
  }, type === 'error' ? 5200 : 2800);
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

/* Кнопки запуска игры, которая сейчас запускается, отключаем и подписываем «Запускается…». */
function refreshLaunchButtons() {
  document.querySelectorAll('[data-launch-id]').forEach((el) => {
    const busy = launching.has(el.dataset.launchId);
    el.disabled = busy;
    el.classList.toggle('is-launching', busy);
    const label = el.querySelector('.btn-label');
    if (label) label.textContent = busy ? 'Запускается…' : 'Запустить';
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
  if (!game || launching.has(id)) return; // уже запускается: повторное нажатие игнорируем
  lockLaunch(id);
  try {
    const updated = await invoke('launch_game', { id });
    upsert(updated);
    toast(`Запускаю «${game.name}»`);
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

async function removeGame(id) {
  const game = state.games.find((g) => g.id === id);
  if (!game) return;
  const ok = await confirmModal({
    title: 'Убрать игру из библиотеки?',
    text: `«${game.name}» исчезнет из ManyGameLib. Сама игра и её файлы на компьютере останутся нетронутыми.`,
    okLabel: 'Убрать',
  });
  if (!ok) return;
  try {
    await invoke('remove_game', { id });
    state.games = state.games.filter((g) => g.id !== id);
    delete state.assets[id];
    if (state.selectedId === id) state.selectedId = null;
    render();
    toast('Игра убрана из библиотеки');
  } catch (e) {
    toast(errText(e), 'error');
  }
}

/* ---------- Выборки ---------- */

const byName = (a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' });
const byPlayed = (a, b) => (b.last_played || 0) - (a.last_played || 0);

function sorted(list) {
  const copy = [...list];
  if (state.sort === 'added') copy.sort((a, b) => b.added_at - a.added_at);
  else if (state.sort === 'played') copy.sort((a, b) => byPlayed(a, b) || byName(a, b));
  else copy.sort(byName);
  return copy;
}

const recentGames = () => state.games.filter((g) => g.last_played).sort(byPlayed);

function matches(list) {
  const q = state.query.trim().toLowerCase();
  return q ? list.filter((g) => g.name.toLowerCase().includes(q)) : list;
}

/* ---------- Рендер ---------- */

function render() {
  const content = $('#content');
  const scroll = content.scrollTop;

  const n = state.games.length;
  $('#libCount').textContent = `${n} ${plural(n, ['игра', 'игры', 'игр'])}`;
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === state.view && !state.query));

  content.replaceChildren();
  content.classList.remove('pad-top');
  state.heroId = null;

  if (n === 0) {
    content.append(renderWelcome());
  } else if (state.query.trim()) {
    content.classList.add('pad-top');
    content.append(renderSearch());
  } else if (state.view === 'settings') {
    content.classList.add('pad-top');
    content.append(renderSettings());
  } else if (state.view === 'favorites') {
    content.classList.add('pad-top');
    content.append(renderSimple('Избранное', state.games.filter((g) => g.favorite).sort(byName),
      'Пока пусто', 'Нажмите «⋯» у игры и добавьте её в избранное.', false));
  } else if (state.view === 'recent') {
    content.classList.add('pad-top');
    content.append(renderSimple('Недавние игры', recentGames(),
      'Вы ещё ничего не запускали', 'Здесь появятся игры, которые вы запустили из ManyGameLib.', true));
  } else {
    content.append(...renderLibrary());
  }

  content.scrollTop = scroll;
  refreshLaunchButtons();
}

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
      h('p', { class: 'hero-sub' }, g.last_played ? formatLast(g.last_played) : 'Ещё не запускалась'),
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
    h('option', { value: 'played' }, 'По последнему запуску'));
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
    section.append(h('div', { class: 'empty' }, h('b', {}, 'Ничего не найдено'), `По запросу «${state.query.trim()}» игр нет.`));
  } else {
    section.append(h('div', { class: 'grid' }, found.map((g) => card(g, {}))));
  }
  return section;
}

/* ---------- Страница настроек ---------- */

const SETTINGS_TABS = [
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
function toggle(value, onChange) {
  const input = h('input', { type: 'checkbox', onChange: (e) => onChange(e.target.checked) });
  input.checked = !!value;
  return h('label', { class: 'switch' }, input, h('span', { class: 'switch-knob' }));
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
    rows.push(settingRow('Своя картинка', 'PNG, JPG, WEBP, GIF, BMP или ICO до 8 МБ. Лучше всего 1920×1080',
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
    settingsCard('Защита данных', 'Список игр хранится безопасно',
      settingRow('Предыдущая версия списка', 'Файл games.json.bak, обновляется при каждом сохранении', null),
      settingRow('Копии за запуски', 'Папка backups: по одной копии за запуск, последние 5', null),
      settingRow('Если файл повредится', 'Он сохранится отдельно, а последняя рабочая копия восстановится сама', null)),
  ];
}

function aboutPanel() {
  ensureAppInfo();
  const i = state.appInfo;
  const v = (x) => (i ? x : '…');
  return settingsCard('ManyGameLib', 'Локальная библиотека игр для Windows',
    settingRow('Версия', null, v(i && `v${i.version}`)),
    settingRow('Electron', null, v(i && i.electron)),
    settingRow('Chromium', null, v(i && i.chrome)),
    settingRow('Node.js', null, v(i && i.node)),
    settingRow('Лицензия', null, v(i && i.license)),
    settingRow('Исходный код', 'Страница проекта на GitHub',
      h('button', { class: 'btn ghost small', type: 'button', onClick: () => openTarget('repo') }, 'Открыть на GitHub')));
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
      : state.settingsTab === 'library' ? libraryPanel() : appearancePanel());
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

/* ---------- Навигация ---------- */

function setView(view) {
  state.view = view;
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
    item('', 'play', 'Запустить', () => launch(game.id)),
    item('', 'star', game.favorite ? 'Убрать из избранного' : 'В избранное', () => toggleFavorite(game.id)),
    item('', 'info', 'Подробнее', () => openDetails(game.id)),
    item('', 'edit', 'Изменить', () => openEditModal(game.id)),
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

function openAddModal() {
  openModal((modal) => {
    modal.classList.add('wide');
    const form = gameForm({
      autofocus: true,
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
      },
    });
    modal.append(modalHead('Добавить игру'), form);
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
        h('dt', {}, 'Добавлена'),
        h('dd', {}, formatDate(game.added_at)),
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
          h('button', { class: 'btn primary small', type: 'button', onClick: () => { closeModal(); launch(game.id); } }, icon('play'), 'Запустить'))));
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

/* ---------- Форма добавления и изменения игры ---------- */

const PICK_TITLES = {
  icon: 'Выберите иконку или обложку игры',
  banner: 'Выберите баннер для верхнего блока',
  logo: 'Выберите логотип игры',
};

function gameForm({ mode = 'add', game = null, assets = null, onDone, autofocus = false }) {
  const editing = mode === 'edit';

  const st = {
    name: game ? game.name : '',
    exe: game ? game.exe_path : '',
    nameTouched: editing,
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

  async function pickExe() {
    try {
      const picked = await dialog.open({
        title: 'Выберите файл запуска игры',
        filters: [
          { name: 'Игры и программы', extensions: ['exe', 'jar', 'bat', 'cmd', 'lnk', 'url', 'com', 'msi'] },
          { name: 'Все файлы', extensions: ['*'] },
        ],
      });
      if (!picked) return;
      st.exe = picked;
      exeInput.value = picked;
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
    } catch (e) {
      showError(errText(e));
    }
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
      input.value = im.path || (im.url ? 'Текущая картинка' : '');
      clear.hidden = !im.url;
    };
    return { row, sync };
  }

  const iconRow = imageRow('icon', 'PNG, JPG, ICO… (необязательно)');
  const bannerRow = imageRow('banner', 'Широкая картинка, например 1920×620');
  const logoRow = imageRow('logo', 'PNG с прозрачным фоном (необязательно)');

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

    const payload = {
      name: st.name.trim(),
      exePath: st.exe,
      hero: { ...st.hero },
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
    field('Иконка или обложка',
      h('div', { class: 'icon-row' },
        iconPick,
        h('div', { class: 'icon-side' },
          iconRow.row,
          h('span', { class: 'hint' }, 'Лучше всего квадрат 512×512 или вертикальная обложка 600×900. Без неё будет цветная плитка с первой буквой.')))),
    h('div', { class: 'hero-cfg' },
      h('div', { class: 'section-title' }, 'Верхний блок'),
      h('p', { class: 'hint' }, 'Так игра выглядит вверху библиотеки, когда она выбрана. Предпросмотр ниже обновляется сразу.'),
      previewBox,
      field('Фон', bgSeg.node),
      bannerField,
      field('Логотип вместо названия', logoRow.row),
      field('Обложка справа', h('div', { class: 'inline' }, artCheck.node, fitSeg.node))),
    error,
    submitBtn);

  // Есть ли несохранённые данные (для защиты от случайного закрытия окна).
  const snap = () => JSON.stringify([
    st.name.trim(), st.exe, st.hero,
    Object.values(st.img).map((v) => [v.mode, v.path]),
  ]);
  const initial = snap();
  form.isDirty = () => !st.busy && snap() !== initial;

  syncImages();
  syncHero();
  updatePreview();
  if (autofocus) setTimeout(() => exeInput.focus(), 60);
  return form;
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
  if (e.key === 'Escape') { closeMenu(); tryDismiss(); }
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
invoke('win_state').then(setMaximized).catch(() => {});
invoke('get_version').then((v) => { $('.brand-text small').textContent = `v${v}`; }).catch(() => {});
window.addEventListener('focus', syncMissing);

refresh();
loadSettings();
