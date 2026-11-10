# Architecture

[English](architecture.md) | [Русский](architecture_RU.md)

ManyGameLib is a small Electron app with three parts and no runtime dependencies. All access to the file system and to processes lives in one place (the main process), and the interface can only reach it through a short, fixed list of commands.

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
| `main.js` | main | Library storage, backups, image copies, launching games, native dialogs, the window |
| `preload.js` | preload (isolated) | Exposes `window.api` to the page with a fixed set of commands |
| `ui/index.html`, `ui/style.css`, `ui/app.js` | renderer | Everything the user sees. No file or process access |

There is no bundler and no framework. `ui/app.js` is one plain script that builds the DOM with a small helper (see [UI](ui.md)).

## Security model

The window is created with:

- `contextIsolation: true`: the page and the preload script run in separate JavaScript worlds.
- `nodeIntegration: false` and `sandbox: true`: the page has no `require`, no Node APIs.
- A Content Security Policy in `ui/index.html`:
  `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'`.
  Only the app's own scripts run (no inline scripts, no remote code). Images may come from the app or from `data:` URLs, because game images are sent to the page as data URLs.

The page cannot read or write arbitrary files. File paths for games and images come from the native open-file dialog (`pick_file`), and the main process validates every path again before using it (existence, extension, size).

## The IPC contract

The preload script exposes `window.api` with four members:

| Member | Direction | Purpose |
|--------|-----------|---------|
| `invoke(cmd, args)` | page → main, request/response | Calls one of the whitelisted commands |
| `pickFile(opts)` | page → main, request/response | Opens the native "open file" dialog (`pick_file`) |
| `win(action)` | page → main, one-way | `minimize`, `toggleMaximize`, `close` for the custom title bar |
| `onWinState(cb)` | main → page | Tells the page when the window is maximized/restored, so it can draw the right button |

### Commands

`invoke` accepts only these names; anything else is rejected in the preload script before it reaches the main process:

| Command | Arguments | Returns |
|---------|-----------|---------|
| `get_version` | none | App version string |
| `get_games` | none | Array of game views |
| `get_missing` | none | Ids of games whose file no longer exists |
| `get_assets` | `{ id }` | `{ icon, banner, logo }` as data URLs (or `null`) |
| `preview_image` | `{ path }` | Data URL for a picked file, before saving |
| `add_game` | `{ name, exePath, images, hero }` | The new game view |
| `update_game` | `{ id, name, exePath, images, hero }` | The updated game view |
| `launch_game` | `{ id }` | The game view with the new `last_played` |
| `toggle_favorite` | `{ id }` | The updated game view |
| `remove_game` | `{ id }` | nothing |
| `win_state` | none | `true` if the window is maximized |

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
4. Register the IPC handlers and create the window.
5. If the library was restored from a backup, show a notice once the window is visible.
