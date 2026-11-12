# Roadmap / План развития

[English](#english) | [Русский](#russian)

---

## English

### Version 1.6.0 - Organization & QoL (In Progress)
*Status: Currently working on this release. Some features are already committed.*

- [ ] **Game Statuses & Tags:** Add "Completed", "Planned", "Playing" statuses with sidebar filters (currently only Favorites exist).
- [ ] **Undo Deletion (Recycle Bin):** Instead of immediate deletion, show an "Undo" button in the toast notification to protect against accidental clicks.
- [ ] **Context Menu Actions:** Add "Show in Folder" and "Copy Path" to the game's right-click menu.
- [ ] **Statistics Page:** A new page with playtime stats, top games of the week/month, and simple charts (data is already being tracked).
- [ ] **Custom Working Directory:** Allow setting a specific `cwd` for game launch (currently defaults to the `.exe` folder).
- [ ] **Launch as Administrator:** Force UAC prompt for games that require it but don't request it automatically. *(Implemented / To be finalized)*.
- [ ] **Game Notes & Completion:** A text field for notes and a "Completion" status dropdown (Not Started / Playing / Completed) in the details view.
- [x] **SteamGridDB Cover Search:** Search and apply covers, banners, logos, and icons using a personal API key (stored securely and separately from main settings). *(Implemented)*

---

## Русский

### Версия 1.6.0 - Организация и Комфорт (В разработке)
*Статус: В данный момент идет работа над релизом. Некоторые функции уже добавлены.*

- [ ] **Категории и теги:** Статусы «Пройдено», «В планах», «Играю» и фильтры для них в боковом меню (сейчас есть только «Избранное»).
- [ ] **Корзина (Отмена удаления):** Вместо мгновенного удаления показывать кнопку «Отменить» в уведомлении, чтобы защитить от случайных кликов.
- [ ] **Действия в меню:** Добавить кнопки «Показать в папке» и «Копировать путь» в контекстное меню игры.
- [ ] **Страница статистики:** Новая вкладка с временем в играх, топом за неделю/месяц и графиком (данные о времени уже собираются).
- [ ] **Свой рабочий каталог:** Возможность указать кастомную папку запуска для игр (сейчас по умолчанию используется папка с `.exe`).
- [ ] **Запуск от администратора:** Принудительный запрос прав (UAC) для игр, которым это нужно. *(Реализовано / Требует доработки)*.
- [ ] **Заметки и прохождение:** Текстовое поле для заметок и выбор статуса прохождения (Не начата / Играю / Пройдена) в деталях игры.
- [x] **Поиск обложек в SteamGridDB:** Поиск и установка обложек, баннеров и логотипов с помощью личного API-ключа (хранится в безопасности отдельно от основных настроек). *(Реализовано)*
