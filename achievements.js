'use strict';

/* Встроенный набор достижений. Всё считается локально по данным библиотеки, журналу сессий и счётчикам действий.
   cur(ctx) возвращает текущее значение, goal это порог: достижение получено, когда cur >= goal.
   ctx: { games, stats (history.stats), profile, counters }. */

const H = 3600;
const count = (ctx, name) => Number(ctx.counters[name]) || 0;
const maxPlaytime = (ctx) => ctx.games.reduce((m, g) => Math.max(m, Number(g.playtime_sec) || 0), 0);
const tagSet = (ctx) => new Set(ctx.games.flatMap((g) => (Array.isArray(g.tags) ? g.tags : []).map((t) => String(t).toLowerCase())));

const ACHIEVEMENTS = [
  // Библиотека
  { id: 'lib_1', group: 'Библиотека', title: 'Первая игра', desc: 'Добавьте игру в библиотеку', goal: 1, cur: (c) => c.games.length },
  { id: 'lib_10', group: 'Библиотека', title: 'Коллекционер', desc: 'Соберите 10 игр', goal: 10, cur: (c) => c.games.length },
  { id: 'lib_50', group: 'Библиотека', title: 'Библиотекарь', desc: 'Соберите 50 игр', goal: 50, cur: (c) => c.games.length },
  { id: 'lib_100', group: 'Библиотека', title: 'Хранитель', desc: 'Соберите 100 игр', goal: 100, cur: (c) => c.games.length },
  // Время
  { id: 'h_1', group: 'Время', title: 'Разминка', desc: 'Наиграйте 1 час', goal: H, cur: (c) => c.stats.total_sec },
  { id: 'h_10', group: 'Время', title: 'Втянулся', desc: 'Наиграйте 10 часов', goal: 10 * H, cur: (c) => c.stats.total_sec },
  { id: 'h_100', group: 'Время', title: 'Сотня', desc: 'Наиграйте 100 часов', goal: 100 * H, cur: (c) => c.stats.total_sec },
  { id: 'h_500', group: 'Время', title: 'Легенда', desc: 'Наиграйте 500 часов', goal: 500 * H, cur: (c) => c.stats.total_sec },
  { id: 'h_1000', group: 'Время', title: 'Тысяча часов', desc: 'Наиграйте 1000 часов', goal: 1000 * H, cur: (c) => c.stats.total_sec },
  { id: 'fav_game', group: 'Время', title: 'Любимчик', desc: 'Проведите в одной игре 10 часов', goal: 10 * H, cur: maxPlaytime },
  { id: 'played_10', group: 'Время', title: 'Разносторонний', desc: 'Поиграйте в 10 разных игр', goal: 10, cur: (c) => c.stats.games_played },
  // Сессии
  { id: 's_1', group: 'Сессии', title: 'Первый запуск', desc: 'Проведите первую игровую сессию через ManyGameLib', goal: 1, cur: (c) => c.stats.sessions },
  { id: 's_25', group: 'Сессии', title: 'Постоянный игрок', desc: 'Сыграйте 25 сессий', goal: 25, cur: (c) => c.stats.sessions },
  { id: 's_100', group: 'Сессии', title: 'Сто сессий', desc: 'Сыграйте 100 сессий', goal: 100, cur: (c) => c.stats.sessions },
  { id: 'marathon', group: 'Сессии', title: 'Марафон', desc: 'Играйте 4 часа подряд в одной сессии', goal: 4 * H, cur: (c) => c.stats.longest_session_sec },
  // Серии
  { id: 'streak_3', group: 'Серии', title: 'Три дня подряд', desc: 'Играйте 3 дня подряд', goal: 3, cur: (c) => c.stats.best_streak_days },
  { id: 'streak_7', group: 'Серии', title: 'Неделя без перерыва', desc: 'Играйте 7 дней подряд', goal: 7, cur: (c) => c.stats.best_streak_days },
  { id: 'streak_30', group: 'Серии', title: 'Месяц в игре', desc: 'Играйте 30 дней подряд', goal: 30, cur: (c) => c.stats.best_streak_days },
  // Порядок
  { id: 'tag_1', group: 'Порядок', title: 'Организатор', desc: 'Поставьте тег хотя бы одной игре', goal: 1, cur: (c) => tagSet(c).size },
  { id: 'tag_5', group: 'Порядок', title: 'Каталогизатор', desc: 'Заведите 5 разных тегов', goal: 5, cur: (c) => tagSet(c).size },
  { id: 'fav_3', group: 'Порядок', title: 'Избранное', desc: 'Добавьте в избранное 3 игры', goal: 3, cur: (c) => c.games.filter((g) => g.favorite).length },
  { id: 'nick', group: 'Порядок', title: 'Знакомство', desc: 'Придумайте ник в профиле', goal: 1, cur: (c) => (c.profile.nickname ? 1 : 0) },
  { id: 'avatar', group: 'Порядок', title: 'Лицо профиля', desc: 'Поставьте аватар', goal: 1, cur: (c) => (c.profile.avatar ? 1 : 0) },
  // Приложение
  { id: 'tray', group: 'Приложение', title: 'В трее', desc: 'Свернуть ManyGameLib в трей', goal: 1, cur: (c) => count(c, 'tray') },
  { id: 'export', group: 'Приложение', title: 'Запасной план', desc: 'Сохраните библиотеку в ZIP', goal: 1, cur: (c) => count(c, 'export') },
  { id: 'import', group: 'Приложение', title: 'Переезд', desc: 'Импортируйте библиотеку из ZIP', goal: 1, cur: (c) => count(c, 'import') },
  { id: 'restore', group: 'Приложение', title: 'Передумал', desc: 'Верните игру из корзины', goal: 1, cur: (c) => count(c, 'restore') },
  { id: 'sgdb', group: 'Приложение', title: 'Художник', desc: 'Загрузите обложку из SteamGridDB', goal: 1, cur: (c) => count(c, 'sgdb') },
];

const COUNTERS = ['tray', 'export', 'import', 'restore', 'sgdb'];

/* Текущее состояние всех достижений. cur не больше goal; ошибка в одном условии не ломает остальные. */
function evaluate(ctx) {
  return ACHIEVEMENTS.map((a) => {
    let cur = 0;
    try { cur = Number(a.cur(ctx)) || 0; } catch { cur = 0; }
    return { id: a.id, group: a.group, title: a.title, desc: a.desc, goal: a.goal, cur: Math.min(cur, a.goal), done: cur >= a.goal };
  });
}

module.exports = { ACHIEVEMENTS, COUNTERS, evaluate };
