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
| `sort` | `name`, `added` or `played` |
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

## Search

The search field updates `state.query` after a **150 ms pause** in typing, not on every keystroke, because each update re-renders the screen. Switching section or adding a game clears the field and cancels any pending update, so an old query cannot come back. Search matches the game name, case-insensitively, as a substring.

## Launch buttons

Every launch button carries `data-launch-id`. `refreshLaunchButtons()` runs after each render and after each lock change; it disables the buttons of games that are launching and swaps the label of the big button. See [Launching](launching.md) for the main-process half of the protection.

## "File not found" refresh

`window` `focus` triggers `syncMissing()`, which asks the main process for the ids of missing games and re-renders only if something changed.

## Windows, menus and forms

- **Modal windows** (add, edit, about, confirm) share one container. Escape or a click on the backdrop closes it, but if a form has unsaved input (`tryDismiss`), the window stays open and a hint is shown; the × button always closes it.
- **Context menu** (right-click or the "⋯" button): launch, favorite, details, edit, remove from library. Clicking the same "⋯" button again closes it.
- **Add/edit form** (`gameForm`) keeps its own local state: the chosen file, the name (auto-filled from the file name until the user types their own), the three images and the top-block settings. On submit it sends one `add_game` or `update_game` request. Errors come back as text and are shown inside the form.
- **Toasts** show short results and errors.
- **Deleting a game** asks for confirmation, and removes only the library entry.

## Settings page and app background

The Settings page is one more value of `view`, drawn by `renderSettings()` with four tabs. A layer behind the interface (`#appBg`) shows the app background, and `applyBackground()` updates it. Sliders change only the style while dragging and save once on release, so there is no re-render and no write per pixel. `body.has-bg` and `body.hero-flat` switch the look of the sidebar, the cards and the top block. All of this is described in [Settings](settings.md).

## Title bar

The system frame is off. `ui/app.js` draws minimize, maximize/restore and close buttons that send `win` messages; the main process tells the page about maximize state so the middle button shows the right icon. The top bar and brand are drag regions, and interactive controls inside them are marked no-drag.

## Language

All visible text is Russian and lives directly in `app.js` and `index.html`. There is no translation layer yet.
