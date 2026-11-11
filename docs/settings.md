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
  "autostart": false,
  "logging": false,
  "javaPath": ""
}
```

| Field | Values | Default | Meaning |
|-------|--------|---------|---------|
| `background.mode` | `default`, `custom`, `none` | `default` | The picture behind the whole interface: the bundled one, the user's own, or none |
| `background.blur` | 0–40 | `4` | Blur of the picture in pixels |
| `background.dim` | 0–90 | `40` | Darkening layer over the picture, in percent |
| `background.file` | file name or `null` | `null` | The user's picture, a file inside `icons\` (a bare name, never a path) |
| `heroBackground` | `true` / `false` | `true` | Whether the top block has its own card background |
| `autostart` | `true` / `false` | `false` | Start with Windows |
| `logging` | `true` / `false` | `false` | Write `logs\manygamelib.log` |
| `javaPath` | string up to 500 chars | `""` | A specific `javaw.exe` for `.jar` files; empty means "search automatically" |

## Reading, validating, saving

**`normalizeSettings(raw)`** is the single gate. Every read and every save goes through it, so the rest of the code can trust the shape:

- unknown keys are dropped;
- a wrong type or an unknown mode becomes the default;
- numbers are rounded and clamped to their range (`blur` 999 becomes 40, `dim` -5 becomes 0);
- `background.file` is accepted only if it is a bare file name (`path.basename(x) === x`), so a hand-edited file cannot point outside `icons\`;
- `mode: custom` without a file becomes `default`.

**`mergeSettings(patch)`** applies a partial change on top of the current settings. It copies only known keys (`heroBackground`, `autostart`, `logging`, `javaPath`, and `background.mode/blur/dim`). The page can never set `background.file` directly; that field is changed only by `set_wallpaper` and `clear_wallpaper`.

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
| `open_external` | `{ target }` | nothing; `target` is `data`, `logs` or `repo` |

`open_external` receives a **keyword**, not a path or a URL: the main process maps `data`, `logs` and `repo` to the data folder, the logs folder and the project page. Anything else is rejected, so the page cannot open arbitrary files or links through it. The window also refuses to navigate and to open new windows (`setWindowOpenHandler` and `will-navigate`).

## App background

Modes:

- **`default`**: the picture bundled with the app, `ui/assets/wallpaper-default.webp` (a 1672×941 WebP, about 200 KB).
- **`custom`**: the user's own picture.
- **`none`**: the plain dark color.

The "game background" is **not** an app-wide mode: a game's own background exists only in the top block (see [Images](images.md)).

### Own picture

`set_wallpaper` runs the same `copyImage()` used for game images (extension check, 8 MB limit) with the kind `wallpaper`, so the copy is `icons\app-wallpaper-<random>.<ext>`. Then it saves the settings with mode `custom`. The previous wallpaper file is removed only **after** the save succeeds; if the save fails, the new copy is removed and the old state stays. `clear_wallpaper` clears the file name, deletes the file and, because a `custom` mode without a file falls back to `default`, returns to the bundled picture. `get_wallpaper` reads the file as a data URL; the page asks for it only when the mode is `custom`.

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

## General settings

**Autostart.** `autostart` is applied with `app.setLoginItemSettings({ openAtLogin })`, and only when `app.isPackaged`. When running from source (`npm start`) it would register `electron.exe` instead of ManyGameLib, so the toggle is disabled in the UI (`get_app_info` returns `packaged`). `afterSettingsChange(prev, next)` calls it only when the value actually changed, and a reset turns it off. At startup the app compares `getLoginItemSettings()` with the setting and fixes a mismatch.

**Logging.** When `logging` is on, `logLine()` appends to `logs\manygamelib.log`:

```
2026-11-11T02:25:11.402Z [info] запуск: Cyberpunk 2077 (D:\Games\Cyberpunk\game.exe)
2026-11-11T02:25:40.118Z [error] launch_game: Файл игры не найден: D:\Games\Old\old.exe
```

It records app start (version, Electron, platform), game launches, the Java that was chosen, library recovery notices, settings events (logging on/off, reset) and **every error returned by an IPC command** (`handle()` logs the channel and the message). The file is rotated at 1 MB (`LOG_MAX_BYTES`): it becomes `manygamelib.log.old` (one old file is kept) and a new file starts. Write errors are swallowed, because logging must never break the app. When logging is off, nothing is written and the folder is not even created. The log stays on the computer; it contains game names and file paths, so look before sharing it.

**Java path.** If `javaPath` is set, `findJavaw()` uses only that file. A wrong path is an explicit error ("Java file from settings not found"), not a silent switch to some other Java. Empty means the automatic search described in [Launching](launching.md). The page picks the file with the same native dialog as everything else.

**Reset.** `reset_settings` writes the defaults, removes the user's wallpaper file, applies the side effects (autostart off) and writes a log line. Games and the library are not touched.

## The Settings page

`render()` shows it when `state.view === 'settings'` (the sidebar item has `data-view="settings"`). Four tabs, remembered in `state.settingsTab`:

| Tab | Contents |
|-----|----------|
| General (Общие) | Autostart, logging (and "Open folder" when on), reset |
| Appearance (Внешний вид) | Background mode, own picture, blur, dim, top block background |
| Library (Библиотека) | Game count, games with a missing file, data folder, Java path, short backup info |
| About (О приложении) | Version, Electron, Chromium, Node.js, license, link to the repository |

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
