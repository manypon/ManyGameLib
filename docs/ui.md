# Interface

[English](ui.md) | [Русский](ui_RU.md)

The interface is plain HTML, CSS and one script, `ui/app.js` (about 1500 lines). There is no framework and no build step. This page explains how it is structured and the few non-obvious decisions in it.

## State

All UI state lives in one object:

| Field | Meaning |
|-------|---------|
| `games` | The list returned by `get_games` |
| `assets` | `id → { icon, banner, logo }` for heavy images, loaded on demand |
| `heroId` | The game currently shown in the top block (`null` if there is no top block on screen) |
| `view` | `library`, `favorites`, `recent` or `settings` |
| `query` | The search text |
| `tagFilter` | The selected tags (lower case); a game must have all of them, see [Tags](#tags) |
| `sort` | `name`, `added`, `played` or `playtime` (most played first) |
| `layout` | `grid` or `list` |
| `selectedId` | The game the user picked for the top block |
| `settings` | The settings object from `get_settings` (see [Settings](settings.md)) |
| `wallpaper` | The user's own app background as a data URL, loaded only in `custom` mode |
| `settingsTab` | The open tab of the Settings page (`general`, `appearance`, `library`, `about`) |
| `appInfo` | Version, data folder and runtime versions from `get_app_info`, loaded once |
| `update` | The update state pushed by the main process (see [Updates](updates.md)) |

The source of truth for the library is the main process. After each command the UI replaces the updated game in `state.games` (`upsert`) or reloads the list (`refresh`).

## Rendering

`h(tag, props, ...children)` creates DOM elements: `class` sets the class name, `onClick`-style props become event listeners, `html` is used only for static SVG icons, everything else becomes an attribute. Text is always added as text nodes, so game names can never inject markup.

`render()` rebuilds the whole `#content` area from `state` and then restores the scroll position. A full re-render is simple and fast enough for hundreds of games. The cases where it must *not* happen (see "Clicks") are handled separately.

What each screen shows:

- **Library:** top block, the "Recent games" row (up to 8), then "All games" as a grid or a list with a sort selector.
- **Favorites / Recent:** a simple list of tiles with a title.
- **Search results:** replaces the screen while the search field is not empty.
- **Welcome:** shown when the library is empty. It is the add-game form itself, so the first launch asks for the first game.

### The top block

The top block shows the selected game; if none is selected, the most recently played one (or the first game in the current sort order if nothing has been played yet). Up to four dots below let the user switch between candidates. Its background, cover and title follow the game's `hero` settings (see [Images](images.md)). The same `heroNode()` function draws the real block and the live preview in the add/edit form.

## Clicks and double-clicks

On a tile, a single click selects the game and a double-click launches it. Two things used to break that, and both are handled:

- **Re-rendering replaced the tile under the cursor.** After the first click the whole screen was rebuilt, so the second click landed on a new element and no double-click fired. Now `selectInPlace()` swaps only the top block and toggles the `selected` class on the existing tiles. Tiles are kept, so the double-click arrives.
- **Scrolling moved the tiles.** Selecting a game scrolls the page back to the top block. That scroll is delayed by 250 ms and cancelled if a double-click follows, so a double-click never has the page jump away first.

In sections that do not have a top block (Favorites, Recent, search), a single click opens the "About" window. That window would cover the second click, so there the single-click action waits 250 ms and is cancelled by a double-click.

The ▶ button on a tile and the context menu stop event propagation so they do not trigger tile actions. Keyboard: Tab moves between tiles, Enter launches, Space does what a click does.

## Tags

A game can have several tags of the user's own (for example "Пройдено", "В планах", "Онлайн"). They are edited in the game form (a chip field: Enter or a comma adds a tag, Backspace removes the last one, existing tags are suggested) and stored as `tags` in `games.json` ([Storage](storage.md)).

- **Sidebar.** The "Теги" block lists all tags with the number of games, in alphabetical order (`allTags()`: tags that differ only by letter case are one tag, the first spelling is shown). A click selects or deselects a tag, "Сбросить" clears the selection. Selecting several tags keeps only the games that have **all** of them (`byTags()`).
- **Where the filter works.** On the library page it shows one list "Теги: … (N)" instead of the top block and rails; the Favorites and Recent pages and the search results are filtered too, so a tag, a search text and a sort order combine. The sidebar block follows the library: a tag that no game has any more is dropped from the selection by itself.
- **Managing.** A right click on a tag opens "Переименовать" and "Удалить тег". Both call `rename_tag` ([Architecture](architecture.md)) once for all games, with one save and a rollback if saving fails. Renaming into an existing tag merges them. The details window also shows the game's tags.
- **Limits.** 12 tags per game, 24 characters each. The main process cleans them again, so the page cannot store anything else.

## Profile

The "Профиль" page (`state.view === 'profile'`) replaces a plain statistics page. It loads `get_profile` and `get_stats` on entering and again after each finished game (`game-updated`).

- **Header.** Avatar (or a letter on a colored circle), nickname (the pencil edits it in place: Enter or leaving the field saves, Esc cancels), "В библиотеке с …", buttons to choose or remove the avatar (`set_avatar`, `clear_avatar`, `set_nickname`).
- **Tiles.** Total time, games with time, last 7 and 30 days, the current day streak (and the best one).
- **Top of games.** A switch "7 дней / 30 дней / Всё время" with bars relative to the leader. The periods come from the session journal ([Storage](storage.md)).
- **Chart.** Bars for the last 30 days, the hint shows the day and the time.

## Search

The search field updates `state.query` after a **150 ms pause** in typing, not on every keystroke, because each update re-renders the screen. Switching section or adding a game clears the field and cancels any pending update, so an old query cannot come back. Search matches the game name, case-insensitively, as a substring.

## Launch buttons

Every launch button carries `data-launch-id`. `refreshLaunchButtons()` runs after each render and after each lock change; it disables the buttons of games that are launching and swaps the label of the big button. See [Launching](launching.md) for the main-process half of the protection.

## "File not found" refresh

`window` `focus` triggers `syncMissing()`, which asks the main process for the ids of missing games and re-renders only if something changed.

## Windows, menus and forms

- **Modal windows** (add, edit, about, confirm) share one container. Escape or a click on the backdrop closes it, but if a form has unsaved input (`tryDismiss`), the window stays open and a hint is shown; the × button always closes it.
- **Context menu** (right-click or the "⋯" button): launch, favorite, details, edit, show in folder, copy the path, remove from library. The main process takes the path for Explorer and the clipboard from the library by id; the page never passes one. Clicking the same "⋯" button again closes it.
- **Add/edit form** (`gameForm`) keeps its own local state: the chosen file, the name (auto-filled from the file name until the user types their own), the launch arguments (the field is hidden for file types that do not use them), the playtime in hours (sent only if the user touched the field), the three images (the icon can come from the game's file, see [Images](images.md)) and the top-block settings. On submit it sends one `add_game` or `update_game` request. Errors come back as text and are shown inside the form.
- **Toasts** show short results and errors.
- **Removing a game** asks no question: the game goes to the trash ([Storage](storage.md#trash)) and a notice "«…» убрана из библиотеки" with the button "Отменить" stays for 8 seconds (`toast` with an `action`). Settings → Library has a "Корзина" card (shown only when it is not empty) with "Вернуть", "Удалить навсегда" and "Очистить". Only the library entry is affected, never the game's files.

## Dropping files into the window

A file dragged from Explorer into the window starts adding a game.

- **Overlay.** While a file is dragged over the window, a dashed frame with "Отпустите, чтобы добавить игру" appears (`dragenter`/`dragleave` with a depth counter, because these events also fire for child elements). Only drags that contain files are handled.
- **`preventDefault` on `dragover` and `drop` is required.** Without it the window would try to open the dropped file as a page. (The main process also blocks navigation as a second line of defence.)
- **Path of a file.** Modern Electron removed `File.path`, so the preload script exposes `window.api.pathForFile(file)` (`webUtils.getPathForFile`).
- **Filtering (`handleDrop`).** Kept: `.exe`, `.jar`, `.bat`, `.cmd`, `.lnk`, `.url`, `.com`, `.msi`. Skipped with a short notice: other types, folders, files that are already in the library (compared case-insensitively) and repeats inside the same drop. At most 25 files are taken. If a window is open, the drop is refused with a notice.
- **A queue of forms.** The first file opens the usual add form with the path, the name, the arguments field and the automatic icon already filled in ([Images](images.md)). The title shows "(2 из 5)". After "Добавить игру" the form for the next file opens. "Пропустить" skips one file; the × button, Escape or a click outside the window ends the whole queue.
- An unmodified prefilled form does not ask for confirmation when closed, because nothing was typed by the user.

## Settings page and app background

The Settings page is one more value of `view`, drawn by `renderSettings()` with four tabs. A layer behind the interface (`#appBg`) shows the app background, and `applyBackground()` updates it. Sliders change only the style while dragging and save once on release, so there is no re-render and no write per pixel. `body.has-bg` and `body.hero-flat` switch the look of the sidebar, the cards and the top block. All of this is described in [Settings](settings.md).

## Title bar

The system frame is off. `ui/app.js` draws minimize, maximize/restore and close buttons that send `win` messages; the main process tells the page about maximize state so the middle button shows the right icon. The top bar and brand are drag regions, and interactive controls inside them are marked no-drag.

## Language

All visible text is Russian and lives directly in `app.js` and `index.html`. There is no translation layer yet.
