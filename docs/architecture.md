# Architecture

[English](architecture.md) | [Русский](architecture_RU.md)

ManyGameLib is a small Electron app with three parts and one runtime dependency (`electron-updater`, used only for installed copies, see [Updates](updates.md)). All access to the file system and to processes lives in one place (the main process), and the interface can only reach it through a short, fixed list of commands.

```
┌────────────────────────┐   IPC (invoke)    ┌─────────────────────────┐
│ ui/  (renderer)        │ ────────────────▶ │ main.js  (main process) │
│ HTML + CSS + app.js    │ ◀──────────────── │ files, processes, dialogs│
└───────────▲────────────┘   {data}/{error}  └─────────────────────────┘
            │ window.api
┌───────────┴────────────┐
│ preload.js             │  contextBridge: whitelist of commands
└────────────────────────┘
```

## Processes and files

| File | Process | Responsibility |
|------|---------|----------------|
| `updater.js` | main | Update check, download and install (loaded by `main.js`) |
| `sgdb.js` | main | Cover search in SteamGridDB, the encrypted API key (loaded by `main.js`, see [Cover search](sgdb.md)) |
| `history.js` | main | Journal of play sessions (`sessions.json`) and the profile statistics (loaded by `main.js`, see [Storage](storage.md)) |
| `zip.js` | main | Reading and writing ZIP for library export and import (loaded by `main.js`, see [Moving the library](transfer.md)) |
| `main.js` | main | Library storage, backups, settings, logging, autostart, image copies, launching games, native dialogs, the window, the tray icon |
| `preload.js` | preload (isolated) | Exposes `window.api` to the page with a fixed set of commands |
| `ui/index.html`, `ui/style.css`, `ui/app.js` | renderer | Everything the user sees. No file or process access |

There is no bundler and no framework. `ui/app.js` is one plain script that builds the DOM with a small helper (see [UI](ui.md)).

## Security model

The window is created with:

- `contextIsolation: true`: the page and the preload script run in separate JavaScript worlds.
- `nodeIntegration: false` and `sandbox: true`: the page has no `require`, no Node APIs.
- A Content Security Policy in `ui/index.html`:
  `default-src 'self'; img-src 'self' data: https://*.steamgriddb.com; style-src 'self' 'unsafe-inline'; script-src 'self'`.
  Only the app's own scripts run (no inline scripts, no remote code). Images may come from the app, from `data:` URLs (game images are sent to the page as data URLs) or, for the cover search thumbnails only, from `steamgriddb.com` (see [Cover search](sgdb.md)).

The window also cannot be navigated away or open new windows (`setWindowOpenHandler` and `will-navigate` block both). `open_external` accepts only the keywords `data`, `logs`, `repo`, `release` and `sgdb_key`, never a path or a URL, so the page cannot use it to open arbitrary files or links.

The page cannot read or write arbitrary files. File paths for games and images come from the native open-file dialog (`pick_file`), and the main process validates every path again before using it (existence, extension, size).

## The IPC contract

The preload script exposes `window.api` with seven members:

| Member | Direction | Purpose |
|--------|-----------|---------|
| `invoke(cmd, args)` | page → main, request/response | Calls one of the whitelisted commands |
| `pickFile(opts)` | page → main, request/response | Opens the native "open file" dialog (`pick_file`) |
| `win(action)` | page → main, one-way | `minimize`, `toggleMaximize`, `close` for the custom title bar |
| `onWinState(cb)` | main → page | Tells the page when the window is maximized/restored, so it can draw the right button |
| `onUpdateState(cb)` | main → page | Pushes the update state (checking, downloading, ready…) |
| `onGameUpdated(cb)` | main → page | Sends a game whose data changed in the background (for example, the playtime after a game closed) |
| `pathForFile(file)` | page → preload | The path of a file dropped into the window (`webUtils.getPathForFile`) |

### Commands

`invoke` accepts only these names; anything else is rejected in the preload script before it reaches the main process:

| Command | Arguments | Returns |
|---------|-----------|---------|
| `get_version` | none | App version string |
| `get_games` | none | Array of game views |
| `get_missing` | none | Ids of games whose file no longer exists |
| `get_assets` | `{ id }` | `{ icon, banner, logo }` as data URLs (or `null`) |
| `preview_image` | `{ path }` | Data URL for a picked file, before saving |
| `add_game` | `{ name, exePath, args, playtimeSec, images, hero, tags }` | The new game view |
| `update_game` | `{ id, name, exePath, args, playtimeSec, images, hero, tags }` | The updated game view; a missing `tags` or `playtimeSec` leaves the stored value |
| `rename_tag` | `{ from, to }` | The views of the changed games. Renames a tag in all games (an empty `to` removes it); see [Tags](ui.md#tags) |
| `launch_game` | `{ id }` | The game view with the new `last_played` and `running: true`; a game that is already running is returned as is |
| `toggle_favorite` | `{ id }` | The updated game view |
| `remove_game` | `{ id }` | nothing. The game moves to the trash (see [Storage](storage.md#trash)) |
| `show_in_folder` | `{ id }` | nothing. Shows the game file in Explorer; if the file is gone but its folder exists, opens the folder; otherwise an error |
| `copy_path` | `{ id }` | nothing. Puts the game file's path on the clipboard |
| `list_trash` | none | The trash: `{ id, name, exe_path, deleted_at, playtime_sec }`, newest first |
| `restore_game` | `{ id }` | The game view; takes the game out of the trash |
| `delete_trash` | `{ id }` or none | The number of games deleted for good (one game, or the whole trash without `id`) |
| `win_state` | none | `true` if the window is maximized |
| `get_settings` | none | The settings object |
| `save_settings` | `{ patch }` | The settings after the change |
| `reset_settings` | none | The default settings |
| `set_wallpaper` | `{ path }` | The settings, with the user's own app background |
| `clear_wallpaper` | none | The settings, with the own background removed |
| `get_wallpaper` | none | The own background as a data URL, or `null` |
| `sgdb_state` | none | `{ hasKey }`; the page never gets the key itself (see [Cover search](sgdb.md)) |
| `sgdb_set_key` | `{ key }` | `{ hasKey, verified }`; refuses a key that SteamGridDB rejects |
| `sgdb_clear_key` | none | `{ hasKey: false }` |
| `sgdb_search` | `{ term }` | Up to 12 games `{ id, name, verified }` |
| `sgdb_images` | `{ gameId, kind }` | Pictures `{ id, url, thumb, width, height, style }`; `kind` is `cover`, `banner`, `logo` or `icon` |
| `sgdb_download` | `{ url }` | `{ path, url }`: a temporary file and its preview |
| `export_library` | none | `{ count, path }` after saving a ZIP, or `null` if the window was cancelled (see [Moving the library](transfer.md)) |
| `import_library` | none | `{ added, skipped, imagesLost }`, or `null` if cancelled |
| `get_update_state` | none | The update state |
| `check_update` | none | The state after a check |
| `download_update` | none | The state (`downloading`) |
| `install_update` | none | nothing; installs and restarts |
| `file_icon` | `{ path }` | The icon of a game file as a data URL, or `null` |
| `get_app_info` | none | Version, data folder, Electron/Chromium/Node versions, license, `packaged` |
| `open_external` | `{ target }` | nothing; `target` is the keyword `data`, `logs` or `repo` |

The settings commands are described in [Settings](settings.md).

### Errors

Every handler in `main.js` is wrapped by `handle()`, which never lets an exception cross the IPC boundary. It returns either `{ data }` or `{ error }` (a human-readable message in Russian). The preload script converts that into a normal promise: `{ data }` resolves with the data, `{ error }` rejects with the message string. The UI shows these messages in toasts or in the form.

## Window

- Frameless window (`frame: false`), 1280×800, minimum 960×600, dark background so there is no white flash. It is shown on `ready-to-show`.
- The title bar is drawn by the UI. The top bar and the brand block are drag regions (`-webkit-app-region: drag`); the search field and window buttons are explicitly `no-drag`.
- Single instance: a second launch does not open a second window. It restores and focuses the existing one (`requestSingleInstanceLock`, `second-instance`).
- The app quits when its window closes (`window-all-closed`).

## Startup order

1. Take the single-instance lock (otherwise quit).
2. Resolve the data folder `%USERPROFILE%\manypon\manygamelib` and create `icons`.
3. Migrate an older library if needed, then load the library. If the file cannot be read, ask "Retry / Exit" in a loop (see [Storage](storage.md)).
4. Load the settings (never blocks startup, see [Settings](settings.md)), write the first log line if logging is on, and make Windows autostart match the setting.
5. Create the updater, register the IPC handlers and create the window. If "Check on startup" is on, a check runs about 4 seconds after the window is ready.
6. If the library was restored from a backup, show a notice once the window is visible.
