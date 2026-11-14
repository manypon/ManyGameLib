# Settings and appearance

[English](settings.md) | [Русский](settings_RU.md)

[← Documentation index](README.md)

The Settings page (sidebar → Settings) controls the app background, the top block, autostart, logging and the Java path. Settings live in their own file, `settings.json`, next to the library, and use the same careful-write ideas as the library (see [Storage](storage.md)). This page explains how they are stored, validated and applied.

## The file

`%USERPROFILE%\manypon\manygamelib\settings.json` is created on the first save (a fresh install has no such file and simply runs on defaults).

```json
{
  "background": { "mode": "default", "blur": 4, "dim": 40, "file": null },
  "heroBackground": true,
  "glass": false,
  "autostart": false,
  "logging": false,
  "javaPath": "",
  "checkUpdates": true,
  "closeAction": "ask",
  "startMinimized": false
}
```

| Field | Values | Default | Meaning |
|-------|--------|---------|---------|
| `background.mode` | `default`, `custom`, `none` | `default` | The picture behind the whole interface: the bundled one, the user's own, or none |
| `background.blur` | 0–40 | `4` | Blur of the picture in pixels |
| `background.dim` | 0–90 | `40` | Darkening layer over the picture, in percent |
| `background.file` | file name or `null` | `null` | The user's picture, a file inside `icons\` (a bare name, never a path) |
| `heroBackground` | `true` / `false` | `true` | Whether the top block has its own card background |
| `glass` | `true` / `false` | `false` | The glass style (see "Glass style"); any non-boolean value becomes `false` |
| `autostart` | `true` / `false` | `false` | Start with Windows |
| `logging` | `true` / `false` | `false` | Write `logs\manygamelib.log` |
| `checkUpdates` | `true` / `false` | `true` | Check GitHub for a newer version after startup (see [Updates](updates.md)) |
| `closeAction` | `ask`, `tray`, `quit` | `ask` | What the window's cross does: ask, hide to the tray, or quit (see "Tray") |
| `startMinimized` | `true` / `false` | `false` | When started by Windows autostart, open straight into the tray |
| `javaPath` | string up to 500 chars | `""` | A specific `javaw.exe` for `.jar` files; empty means "search automatically" |

## Reading, validating, saving

**`normalizeSettings(raw)`** is the single gate. Every read and every save goes through it, so the rest of the code can trust the shape:

- unknown keys are dropped;
- a wrong type or an unknown mode becomes the default;
- numbers are rounded and clamped to their range (`blur` 999 becomes 40, `dim` -5 becomes 0);
- `background.file` is accepted only if it is a bare file name (`path.basename(x) === x`), so a hand-edited file cannot point outside `icons\`;
- `mode: custom` without a file becomes `default`.

**`mergeSettings(patch)`** applies a partial change on top of the current settings. It copies only known keys (`heroBackground`, `glass`, `autostart`, `logging`, `javaPath`, `checkUpdates`, `closeAction`, `startMinimized`, and `background.mode/blur/dim`). The page can never set `background.file` directly; that field is changed only by `set_wallpaper` and `clear_wallpaper`.

**`saveSettings(next)`** writes `settings.json.tmp`, copies the current file to `settings.json.bak`, then renames the temporary file over the real one (with the same short retry on locked files as the library).

**`loadSettings()`** never prevents the app from starting:

| Situation | Result |
|-----------|--------|
| No file | Defaults |
| File is valid | Used (after `normalizeSettings`) |
| File is corrupted (not JSON, not an object) | Renamed to `settings.corrupt-<date>.json`, then `settings.json.bak` is tried, then defaults |
| File cannot be read (locked) | Defaults for this session; the file is **not** renamed, because it is not corrupted |

Unlike the library, there is no "Retry / Exit" dialog: settings are not critical. The trade-off is that if the file was locked at startup and the user changes a setting in that session, the save writes the current in-memory values over it.

## Commands

| Command | Arguments | Returns |
|---------|-----------|---------|
| `get_settings` | none | The settings object |
| `save_settings` | `{ patch }` | The settings after the change |
| `reset_settings` | none | The default settings |
| `set_wallpaper` | `{ path }` | The settings (mode becomes `custom`) |
| `clear_wallpaper` | none | The settings (picture removed) |
| `get_wallpaper` | none | The user's picture as a data URL, or `null` |
| `get_app_info` | none | `{ version, dataDir, repo, license, electron, chrome, node, packaged }` |
| `open_external` | `{ target }` | nothing; `target` is `data`, `logs`, `repo` or `release` |

`open_external` receives a **keyword**, not a path or a URL: the main process maps `data`, `logs`, `repo` and `release` to the data folder, the logs folder, the project page and the latest release page. Anything else is rejected, so the page cannot open arbitrary files or links through it. The window also refuses to navigate and to open new windows (`setWindowOpenHandler` and `will-navigate`).

## App background

Modes:

- **`default`**: the picture bundled with the app, `ui/assets/wallpaper-default.webp` (a 1672×941 WebP, about 200 KB).
- **`custom`**: the user's own picture.
- **`none`**: the plain dark color.

The "game background" is **not** an app-wide mode: a game's own background exists only in the top block (see [Images](images.md)).

### Own picture

`set_wallpaper` runs the same `copyImage()` used for game images (extension check, size limit) with the kind `wallpaper` and its own limit of **40 MB** (`MAX_WALLPAPER_BYTES`, instead of 8 MB, because an animated GIF is big), so the copy is `icons\app-wallpaper-<random>.<ext>`. Then it saves the settings with mode `custom`. The previous wallpaper file is removed only **after** the save succeeds; if the save fails, the new copy is removed and the old state stays. `clear_wallpaper` clears the file name, deletes the file and, because a `custom` mode without a file falls back to `default`, returns to the bundled picture. An animated GIF stays animated, because the picture is an ordinary CSS background; the blur is applied to every frame, so with a large GIF a low blur is lighter for the graphics card. `get_wallpaper` reads the file as a data URL (with the same 40 MB limit); the page asks for it only when the mode is `custom`.

### How it is drawn

`ui/index.html` has a layer behind the whole interface:

```html
<div class="app-bg" id="appBg">
  <div class="app-bg-img"></div>   <!-- background-image + filter: blur(Npx) -->
  <div class="app-bg-dim"></div>   <!-- dark layer, opacity = dim / 100 -->
</div>
```

`applyBackground()` in `ui/app.js` sets the image, the blur and the dim opacity, and toggles `body.has-bg`. While `has-bg` is on, the sidebar and the settings cards become semi-transparent with a light blur (`backdrop-filter`), so the picture shows through. The picture element grows by `2 × blur` pixels on every side so the blurred edges never show empty space. The layer is fixed and painted once; scrolling the content does not repaint it.

### Sliders

A slider fires two events. `input` (while dragging) only calls `applyBackground()`: the picture changes instantly and nothing is written. `change` (on release) calls `saveSettingsPatch()` once. This avoids both a full page re-render and a write on every pixel of movement. If a save fails, the page reloads the real values from `get_settings`.

## The top block over a background

With a background on, the live top block becomes a separate card: margins of 76 px at the top and 40 px at the sides, rounded corners, a border and a shadow, with a darkening gradient inside it instead of fading into the page. Without a background it stays full-width as before. A picture and the blurred game art are never blended, which is why the card has a sharp edge.

The `heroBackground` toggle removes the card itself. `body.hero-flat` hides `.hero-bg`, the border and the shadow, so the title, the buttons and the cover sit directly on the app background (with a soft text shadow for readability). The selectors are scoped to `.content > .hero`, so the live preview inside the add/edit form keeps showing the game's own background. The toggle only hides it on the library screen; the game's saved `hero` settings are untouched.

## Glass style

The toggle "Стеклянное оформление" (Settings → Appearance → "Стиль", off by default) sets `body.glass`. It only changes how the window looks; no layout code depends on it.

- **Frame.** The shell gets 12 px of padding and a 12 px gap, so the sidebar floats as a rounded card (22 px) and the right part is inset from the window edges. The top bar becomes a floating glass panel (56 px) and the page scrolls under it. The top block is always a card with a glass edge (as with a background), with 72 px above it and 40 px at the sides.
- **Glass surfaces.** Sidebar, top bar, settings, profile and achievement cards get a translucent fill, a light border, an inner highlight at the top edge and `backdrop-filter: blur(22px) saturate(1.5)`. Windows, the context menu and notices are denser (74 % fill, blur 30 px) so text stays readable on any picture; the dark layer behind a window is lighter.
- **Cheaper parts.** Game tiles and list rows get only the border and the highlight, with no blur of their own (there can be hundreds of them). Buttons, fields and the "Играет"/"Пройдена" badges are tinted and bordered.
- **Without an own background** (`background.mode` is `none`) the layer behind the glass is soft colored blobs (four radial gradients over the usual dark color, no animation) instead of plain dark, so the glass has something to blur; the darkening layer is hidden. With the bundled or own picture the glass blurs that picture, and the blur and darkening sliders still work.
- **Cost.** Blur is the expensive part of the style, which is why only large panels have it. The page tells the user it can be heavier on weak graphics cards.

All rules live in one block at the end of `ui/style.css` under `.glass`, after the `.has-bg` rules, so turning the toggle off returns the ordinary look exactly.

## General settings

**Autostart.** `autostart` is applied with `app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] })`, and only when `app.isPackaged`. When running from source (`npm start`) it would register `electron.exe` instead of ManyGameLib, so the toggle is disabled in the UI (`get_app_info` returns `packaged`). `afterSettingsChange(prev, next)` calls it only when the value actually changed, and a reset turns it off. At startup the app compares `getLoginItemSettings({ args })` with the setting and fixes a mismatch.

**Logging.** When `logging` is on, `logLine()` appends to `logs\manygamelib.log`:

```
2026-11-11T02:25:11.402Z [info] запуск: Cyberpunk 2077 (D:\Games\Cyberpunk\game.exe)
2026-11-11T02:25:40.118Z [error] launch_game: Файл игры не найден: D:\Games\Old\old.exe
```

It records app start (version, Electron, platform), game launches, the Java that was chosen, library recovery notices, settings events (logging on/off, reset) and **every error returned by an IPC command** (`handle()` logs the channel and the message). The file is rotated at 1 MB (`LOG_MAX_BYTES`): it becomes `manygamelib.log.old` (one old file is kept) and a new file starts. Write errors are swallowed, because logging must never break the app. When logging is off, nothing is written and the folder is not even created. The log stays on the computer; it contains game names and file paths, so look before sharing it.

**Java path.** If `javaPath` is set, `findJavaw()` uses only that file. A wrong path is an explicit error ("Java file from settings not found"), not a silent switch to some other Java. Empty means the automatic search described in [Launching](launching.md). The page picks the file with the same native dialog as everything else.

## Tray

The cross of the window (and Alt+F4) is handled in `onCloseRequest`, according to `closeAction`:

- `quit`: the window closes and the app exits.
- `tray`: the window is hidden and an icon appears near the clock. A click on the icon or "Открыть ManyGameLib" in its menu shows the window again (and removes the icon); "Выйти" in the menu quits. A second copy of the app started by the user also shows the hidden window.
- `ask`: a small native dialog "Что сделать при закрытии окна?" with the buttons "Свернуть в трей", "Закрыть", "Отмена" and the checkbox "Запомнить выбор". "Отмена" does nothing and remembers nothing. With the checkbox on, the choice is written to `closeAction`, so the question is not asked again; it can be changed on the General tab. Only one dialog can be open at a time.

If the tray icon cannot be created, the window is not hidden (there would be no way to get it back) and the app quits instead. The `quitting` flag is set in `before-quit` and on `session-end`, so quitting from the menu, an update install and Windows shutdown are never blocked by "hide to tray". Time in games keeps being counted while the window is hidden.

**Open in the tray.** Autostart registers the app with the argument `--hidden`. If `startMinimized` is on and the argument is present, the window is created but not shown and the tray icon is placed at once. A normal start (shortcut, installer) always shows the window, and so does a start with the "library restored" notice. Copies registered by an older version have no argument; the startup check sees the mismatch and registers them again.

**Reset.** `reset_settings` writes the defaults, removes the user's wallpaper file, applies the side effects (autostart off) and writes a log line. Games and the library are not touched.

## The Settings page

`render()` shows it when `state.view === 'settings'` (the sidebar item has `data-view="settings"`). Four tabs, remembered in `state.settingsTab`:

| Tab | Contents |
|-----|----------|
| General (Общие) | Autostart, open in the tray, the window's cross, logging (and "Open folder" when on), reset |
| Appearance (Внешний вид) | Background mode, own picture, blur, dim, top block background |
| Library (Библиотека) | Game count, games with a missing file, data folder, Java path, export and import (see [Moving the library](transfer.md)), the trash (see [Storage](storage.md#trash)), the SteamGridDB key (see [Cover search](sgdb.md)), short backup info |
| About (О приложении) | Updates card (see [Updates](updates.md)), version, Electron, Chromium, Node.js, license, link to the repository |

The page is built from small helpers: `settingsCard`, `settingRow`, `toggle`, `slider`, and the existing `segmented`. Data for About and the data folder come from `get_app_info` through `ensureAppInfo()`.

## Code map

| Where | What |
|-------|------|
| `main.js` | `normalizeSettings`, `mergeSettings`, `loadSettings`, `saveSettings`, `afterSettingsChange`, `applyAutostart`, `writeLog` / `logLine`, `findJavaw` (step 0), the commands above |
| `preload.js` | The command whitelist |
| `ui/index.html` | The `#appBg` layer and the Settings sidebar item |
| `ui/app.js` | `applyBackground`, `loadSettings`, `saveSettingsPatch`, `pickWallpaper`, `clearWallpaper`, `appearancePanel`, `generalPanel`, `libraryPanel`, `aboutPanel`, `renderSettings` |
| `ui/style.css` | `.app-bg*`, `.has-bg`, `.hero-flat`, `.settings*`, `.s-card`, `.switch` |
| `ui/assets/` | `wallpaper-default.webp` |

Related: [Storage](storage.md), [Images](images.md), [Launching](launching.md), [Interface](ui.md), [Architecture](architecture.md).
