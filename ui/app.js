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

const state = {
  games: [],
  view: 'library',      // library | favorites | recent
  query: '',
  sort: 'name',         // name | added | played
  layout: 'grid',       // grid | list
  selectedId: null,
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
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  close: svg('<path d="m5 5 14 14M19 5 5 19"/>'),
  grid: svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
  list: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
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
  for (const ch of str) x = (x * 31 + ch.codePointAt(0)) >>> 0;
  return x % 360;
}

function errText(e) {
  return typeof e === 'string' ? e : (e && e.message) || 'Что-то пошло не так';
}

/* Обложка: иконка игры или цветная заглушка с первой буквой. */
function coverNode(game) {
  if (game.icon) return h('img', { src: game.icon, alt: '', draggable: 'false' });
  const hue = hueOf(game.name);
  const letter = (game.name.trim()[0] || '?').toUpperCase();
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

async function launch(id) {
  const game = state.games.find((g) => g.id === id);
  if (!game) return;
  try {
    const updated = await invoke('launch_game', { id });
    upsert(updated);
    toast(`Запускаю «${game.name}»`);
  } catch (e) {
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

  if (n === 0) {
    content.append(renderWelcome());
  } else if (state.query.trim()) {
    content.classList.add('pad-top');
    content.append(renderSearch());
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
}

/* Первый запуск: библиотека пуста — просим добавить первую игру. */
function renderWelcome() {
  const form = gameForm({
    submitLabel: 'Добавить игру',
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
        h('p', {}, 'Укажите файл запуска, иконку и название — и игра появится в библиотеке. Дальше запускать её можно одним нажатием.')),
      h('div', { class: 'welcome-form' }, form)));
}

function renderLibrary() {
  const parts = [];
  const recent = recentGames();
  const pool = recent.length ? recent : sorted(state.games);
  const candidates = pool.slice(0, 4);

  let hero = state.games.find((g) => g.id === state.selectedId);
  if (!hero) hero = candidates[0];
  parts.push(renderHero(hero, candidates));

  if (recent.length) {
    parts.push(h('section', { class: 'section' },
      h('div', { class: 'section-head' },
        h('h2', {}, 'Недавние игры'),
        h('button', { class: 'link-btn', onClick: () => setView('recent') }, 'Показать все', icon('arrow'))),
      h('div', { class: 'rail' }, recent.slice(0, 8).map((g) => card(g, { chip: true, hero: true })))));
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

function renderHero(game, candidates) {
  const bg = game.icon
    ? h('img', { src: game.icon, alt: '' })
    : h('div', {
        class: 'fallback',
        style: `background:linear-gradient(135deg,hsl(${hueOf(game.name)} 55% 28%),hsl(${(hueOf(game.name) + 50) % 360} 55% 12%))`,
      });

  return h('section', { class: 'hero' },
    h('div', { class: 'hero-bg' }, bg),
    h('div', { class: 'hero-art' }, coverNode(game)),
    h('div', { class: 'hero-body', key: game.id },
      h('div', { class: 'hero-eyebrow' }, icon('clock'), game.last_played ? 'Последний запуск' : 'В библиотеке'),
      h('h1', { class: 'hero-title' }, game.name),
      h('p', { class: 'hero-sub' }, game.last_played ? formatLast(game.last_played) : 'Ещё не запускалась'),
      h('p', { class: 'hero-path', title: game.exe_path }, game.exe_path),
      h('div', { class: 'hero-actions' },
        h('button', { class: 'btn primary', onClick: () => launch(game.id) }, icon('play'), 'Запустить'),
        h('button', { class: 'btn ghost', onClick: () => openDetails(game.id) }, icon('info'), 'Подробнее'),
        h('button', { class: 'btn ghost icon', title: 'Ещё', onClick: (e) => openMenu(e, game, true) }, icon('more')))),
    candidates.length > 1 && h('div', { class: 'hero-dots' },
      candidates.map((c) => h('button', {
        class: c.id === game.id ? 'on' : '',
        title: c.name,
        onClick: () => selectGame(c.id, false),
      }))));
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

/* ---------- Карточки ---------- */

function card(game, { chip = false, hero = false } = {}) {
  const el = h('div', {
    class: 'card' + (hero && game.id === state.selectedId ? ' selected' : ''),
    title: game.name,
    onClick: () => (hero ? selectGame(game.id, true) : openDetails(game.id)),
    onDblclick: () => launch(game.id),
    onContextmenu: (e) => openMenu(e, game, false),
  },
    h('div', { class: 'cover' + (game.missing ? ' missing' : '') },
      coverNode(game),
      game.missing && h('span', { class: 'miss-badge' }, 'Файл не найден'),
      game.favorite && h('span', { class: 'fav-badge', html: ICON.star }),
      chip && h('span', { class: 'chip' }, icon('clock'), formatLast(game.last_played)),
      h('button', {
        class: 'play-fab', title: 'Запустить',
        onClick: (e) => { e.stopPropagation(); launch(game.id); },
        onDblclick: (e) => e.stopPropagation(),
      }, icon('play'))),
    h('div', { class: 'card-name' }, game.name));
  return el;
}

function addTile() {
  return h('div', { class: 'card add', onClick: openAddModal },
    h('div', { class: 'cover' }, icon('plus'), h('span', {}, 'Добавить игру')));
}

function row(game, hero) {
  return h('div', {
    class: 'row' + (hero && game.id === state.selectedId ? ' selected' : ''),
    onClick: () => (hero ? selectGame(game.id, true) : openDetails(game.id)),
    onDblclick: () => launch(game.id),
    onContextmenu: (e) => openMenu(e, game, false),
  },
    h('div', { class: 'thumb' }, coverNode(game)),
    h('div', { style: 'min-width:0' },
      h('div', { class: 'r-name' }, game.name),
      h('div', { class: 'r-path', title: game.exe_path }, game.missing ? 'Файл не найден — ' + game.exe_path : game.exe_path)),
    h('div', { class: 'r-time' }, formatLast(game.last_played)),
    h('button', { class: 'r-btn', title: 'Ещё', onClick: (e) => { e.stopPropagation(); openMenu(e, game, false); } }, icon('more')),
    h('button', { class: 'r-btn play', title: 'Запустить', onClick: (e) => { e.stopPropagation(); launch(game.id); } }, icon('play')));
}

/* ---------- Навигация ---------- */

function setView(view) {
  state.view = view;
  state.query = '';
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

function closeMenu() {
  const m = $('#menu');
  m.hidden = true;
  m.replaceChildren();
}

function openMenu(e, game) {
  e.preventDefault();
  e.stopPropagation();
  const m = $('#menu');
  const item = (cls, ic, label, fn) =>
    h('button', { class: cls, onClick: () => { closeMenu(); fn(); } }, icon(ic), label);

  m.replaceChildren(
    item('', 'play', 'Запустить', () => launch(game.id)),
    item('', 'star', game.favorite ? 'Убрать из избранного' : 'В избранное', () => toggleFavorite(game.id)),
    item('', 'info', 'Подробнее', () => openDetails(game.id)),
    h('hr'),
    item('danger', 'trash', 'Убрать из библиотеки', () => removeGame(game.id)));
  m.hidden = false;

  // Позиция: у курсора, но не за краем окна.
  const r = e.currentTarget instanceof Element && e.type === 'click'
    ? e.currentTarget.getBoundingClientRect() : null;
  let x = r ? r.left : e.clientX;
  let y = r ? r.bottom + 6 : e.clientY;
  const { width, height } = m.getBoundingClientRect();
  x = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  y = Math.max(8, Math.min(y, window.innerHeight - height - 8));
  m.style.left = `${x}px`;
  m.style.top = `${y}px`;
}

document.addEventListener('mousedown', (e) => {
  if (!$('#menu').hidden && !e.target.closest('#menu')) closeMenu();
});
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.card, .row, input')) e.preventDefault();
});

/* ---------- Модальные окна ---------- */

let closeCurrent = null;

function closeModal() {
  if (closeCurrent) { closeCurrent(); closeCurrent = null; }
}

function openModal(build) {
  closeModal();
  const backdrop = h('div', { class: 'backdrop' });
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeModal(); });
  build(modal);
  backdrop.append(modal);
  $('#overlay').append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  closeCurrent = () => backdrop.remove();
}

const modalHead = (title) =>
  h('div', { class: 'modal-head' },
    h('h3', {}, title),
    h('button', { class: 'x-btn', title: 'Закрыть', onClick: closeModal }, icon('close')));

function openAddModal() {
  openModal((modal) => {
    modal.append(
      modalHead('Добавить игру'),
      gameForm({
        submitLabel: 'Добавить игру',
        autofocus: true,
        onDone: (game) => {
          closeModal();
          upsert(game);
          state.selectedId = game.id;
          state.view = 'library';
          state.query = '';
          $('#search').value = '';
          render();
          $('#content').scrollTop = 0;
          toast(`«${game.name}» добавлена в библиотеку`);
        },
      }));
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
        h('button', { class: 'btn danger small', onClick: () => { closeModal(); removeGame(game.id); } }, icon('trash'), 'Убрать'),
        h('div', { style: 'display:flex;gap:10px' },
          h('button', { class: 'btn ghost small', onClick: () => { closeModal(); toggleFavorite(game.id); } },
            icon('star'), game.favorite ? 'Из избранного' : 'В избранное'),
          h('button', { class: 'btn primary small', onClick: () => { closeModal(); launch(game.id); } }, icon('play'), 'Запустить'))));
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
          h('button', { class: 'btn ghost small', onClick: () => { finish(false); closeModal(); } }, 'Отмена'),
          h('button', { class: 'btn danger small', onClick: () => { finish(true); closeModal(); } }, okLabel)));
    });
    // Закрытие по Esc/клику мимо тоже означает «отмена».
    const prev = closeCurrent;
    closeCurrent = () => { prev(); finish(false); };
  });
}

/* ---------- Форма добавления игры ---------- */

function gameForm({ submitLabel, onDone, autofocus = false }) {
  const st = { name: '', exe: '', icon: '', nameTouched: false, busy: false };

  const error = h('div', { class: 'form-error', hidden: true });
  const showError = (msg) => { error.textContent = msg; error.hidden = !msg; };

  const nameInput = h('input', {
    class: 'input', type: 'text', maxlength: '80', placeholder: 'Например, Elden Ring', spellcheck: 'false',
    onInput: (e) => { st.name = e.target.value; st.nameTouched = true; },
  });

  const exeInput = h('input', {
    class: 'input', type: 'text', readonly: true, placeholder: 'C:\\Games\\Game\\game.exe',
    onClick: pickExe,
  });

  const iconInput = h('input', {
    class: 'input', type: 'text', readonly: true, placeholder: 'PNG, JPG, ICO… (необязательно)',
    onClick: pickIcon,
  });

  const preview = h('button', { class: 'icon-pick', type: 'button', title: 'Выбрать иконку', onClick: pickIcon },
    h('span', { html: ICON.image, style: 'display:contents' }));

  async function pickExe() {
    try {
      const path = await dialog.open({
        multiple: false,
        directory: false,
        title: 'Выберите файл запуска игры',
        filters: [
          { name: 'Игры и программы', extensions: ['exe', 'jar', 'bat', 'cmd', 'lnk', 'url', 'com', 'msi'] },
          { name: 'Все файлы', extensions: ['*'] },
        ],
      });
      if (!path) return;
      st.exe = path;
      exeInput.value = path;
      showError('');
      if (!st.nameTouched || !st.name.trim()) {
        const parts = path.split(/[\\/]/).filter(Boolean);
        const clean = (s) => s.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim();
        let guess = clean(parts.pop() || '');
        // У exe часто общее имя (launcher, game…) — тогда берём название папки игры.
        if (/^(launcher|game|start|play|run|main|app|bin|client|win64|shipping)$/i.test(guess) && parts.length) {
          guess = clean(parts.pop());
        }
        st.name = guess;
        nameInput.value = st.name;
      }
    } catch (e) {
      showError(errText(e));
    }
  }

  async function pickIcon() {
    try {
      const path = await dialog.open({
        multiple: false,
        directory: false,
        title: 'Выберите иконку игры',
        filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'ico', 'bmp', 'gif'] }],
      });
      if (!path) return;
      const url = await invoke('preview_icon', { path });
      st.icon = path;
      iconInput.value = path;
      preview.classList.add('filled');
      preview.replaceChildren(h('img', { src: url, alt: '' }));
      showError('');
    } catch (e) {
      showError(errText(e));
    }
  }

  const submitBtn = h('button', { class: 'btn primary wide', type: 'submit' }, submitLabel);

  const form = h('form', { class: 'form', novalidate: true, onSubmit: async (e) => {
    e.preventDefault();
    if (st.busy) return;
    if (!st.exe) return showError('Выберите файл, которым запускается игра.');
    if (!st.name.trim()) { nameInput.focus(); return showError('Введите название игры.'); }

    st.busy = true;
    submitBtn.disabled = true;
    showError('');
    try {
      const game = await invoke('add_game', {
        name: st.name.trim(),
        exePath: st.exe,
        iconPath: st.icon || null,
      });
      onDone(game);
    } catch (err) {
      showError(errText(err));
      st.busy = false;
      submitBtn.disabled = false;
    }
  } },
    h('div', { class: 'field' },
      h('span', { class: 'field-label' }, 'Путь к игре'),
      h('div', { class: 'pick-row' },
        exeInput,
        h('button', { class: 'btn ghost small', type: 'button', onClick: pickExe }, 'Обзор…'))),
    h('div', { class: 'field' },
      h('span', { class: 'field-label' }, 'Иконка'),
      h('div', { class: 'icon-row' },
        preview,
        h('div', { class: 'icon-side' },
          h('div', { class: 'pick-row' },
            iconInput,
            h('button', { class: 'btn ghost small', type: 'button', onClick: pickIcon }, 'Обзор…')),
          h('span', { class: 'hint' }, 'Без иконки будет цветная плитка с первой буквой названия.')))),
    h('label', { class: 'field' },
      h('span', { class: 'field-label' }, 'Название'),
      nameInput),
    error,
    submitBtn);

  if (autofocus) setTimeout(() => exeInput.focus(), 60);
  return form;
}

/* ---------- Старт ---------- */

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeMenu(); closeModal(); }
});

$('#nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (btn) setView(btn.dataset.view);
});

$('#search').addEventListener('input', (e) => {
  state.query = e.target.value;
  render();
});

$('#wMin').addEventListener('click', () => appWindow.minimize());
$('#wMax').addEventListener('click', () => appWindow.toggleMaximize());
$('#wClose').addEventListener('click', () => appWindow.close());

refresh();