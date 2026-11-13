# Storage and backups

[English](storage.md) | [Русский](storage_RU.md)

The library is a single JSON file plus a folder of images. The design goal is simple: **a game list must survive crashes, locked files and corruption**, and the app must never silently start with an empty library over real data.

## Where data lives

`%USERPROFILE%\manypon\manygamelib\`

```
manygamelib/
├─ games.json                       the library
├─ games.json.bak                   previous version, refreshed on every save
├─ games.json.tmp                   temporary file during a save (normally absent)
├─ games.corrupt-<date>.json        a corrupted file, kept aside (only after a problem)
├─ settings.json                    app settings (created on the first save)
├─ settings.json.bak                previous version of the settings
├─ sessions.json                    journal of play sessions (see Play sessions)
├─ profile.json                     nickname, avatar file name, start date (see Profile)
├─ trash.json                       games removed from the library (see Trash)
├─ secrets.json                     the SteamGridDB API key, encrypted by Windows (created when you save a key, see Cover search)
├─ settings.corrupt-<date>.json     a corrupted settings file, kept aside (only after a problem)
├─ logs/
│  ├─ manygamelib.log               the log (only when logging is on)
│  └─ manygamelib.log.old           the previous log after rotation at 1 MB
├─ backups/
│  └─ games-<date>_<time>.json      one copy per app start, last 5 kept
└─ icons/
   ├─ <id>-<kind>-<random>.<ext>    copies of icons, banners and logos
   └─ app-wallpaper-<random>.<ext>  the user's own app background (if chosen)
```

Settings, the app background and the log are described in [Settings](settings.md). They are stored separately from the library, and a damaged `settings.json` never affects `games.json`.

Timestamps in file names are UTC.

## `games.json`

A JSON array of game objects:

```json
{
  "id": "1731234567890",
  "name": "Hollow Knight",
  "exe_path": "D:\\Games\\HK\\hollow_knight.exe",
  "args": "-windowed",
  "workdir": "",
  "admin": false,
  "note": "",
  "status": "",
  "icon_file": "1731234567890-icon-m3k2x9.png",
  "banner_file": null,
  "logo_file": null,
  "hero": { "bg": "blur", "art": true, "fit": "cover" },
  "tags": ["Онлайн", "Пройдено"],
  "favorite": false,
  "last_played": 1731300000000,
  "playtime_sec": 45000,
  "added_at": 1731234567890
}
```

- `id` is the creation time in milliseconds as a string. If it is already taken, it is incremented until it is unique.
- `name` is trimmed and cut to 80 characters.
- `*_file` fields hold only a file name inside `icons/`, never a path, so the folder can be moved to another computer.
- `hero` is normalized on every read: unknown values fall back to `blur`, `true` and `cover` (see [Images](images.md)).
- `tags` is a list of the user's own labels, see [Tags](ui.md#tags). On every read and write it is cleaned: only strings, line breaks and control characters become spaces, at most 24 characters each and 12 per game, and tags that differ only in letter case count as one (the first stays). A missing field means no tags.
- `exe_path` is an absolute path as chosen by the user.
- `playtime_sec` is the time played, in seconds (integer, at most 100,000 hours; a missing field means 0). It is added to automatically and can be set by hand, see [Launching](launching.md).
- `workdir` is the working folder the game is started in (empty: the folder of the file; older games may not have the field; at most 500 characters). `admin` is `true` if the game is started as administrator. Both are used only for `.exe`, `.com` and `.jar`, see [Launching](launching.md).
- `note` is the user's own note (up to 2000 characters, line breaks kept, other control characters removed). `status` is the playthrough state: `""` (not started, the default), `"playing"` or `"completed"`; any other value becomes `""`. Older games may not have these fields.
- `args` is the launch arguments as one string (empty by default; older games may not have the field). Line breaks and control characters are removed, at most 1000 characters.
- Times are Unix milliseconds.

## Writing safely

`saveGames()` follows this order:

1. Write the whole list to `games.json.tmp`.
2. Copy the current `games.json` to `games.json.bak`.
3. Rename the temporary file over `games.json`.

A crash during step 1 leaves the real file untouched. The rename in step 3 is atomic on the same volume, so `games.json` is always either the old or the new complete file. The rename is retried a few times (waits of 150, 300 and 450 ms) for the errors that antivirus or cloud-sync software causes (`EBUSY`, `EPERM`, `EACCES`, and similar).

### `commit()` and rollback

Changes that add or edit a game go through `commit(next)`: it swaps the in-memory list, saves, and if saving fails puts the old list back. Memory and disk therefore never disagree. Image files copied for the change are deleted again if the save fails (see [Images](images.md)).

Simple changes (`toggle_favorite`, the `last_played` update after a launch) call `saveGames()` directly.

## Trash

## Play sessions

`sessions.json` is an array of `{ id, name, start, sec }`: the game id, its name at that moment, the start time (ms) and the length in seconds. `history.js` appends an entry in `addPlaytime`, so exactly the sessions that count for playtime are recorded (60 seconds and longer, and only if the playtime was saved). The file holds at most 20 000 entries (the oldest are dropped) and is written like the library (temporary file, then rename). It is not trusted: bad entries are skipped, a damaged file is renamed to `sessions.corrupt-<date>.json` and the journal starts again; `games.json` is never affected. A failed write is only logged.

`get_stats` builds the profile statistics from it: last 7 and 30 days (a session that crosses midnight is split between the days), a daily bar chart for 30 days, a top of games per period and day streaks. Time played before the journal existed is only in `playtime_sec` and shows in "all time". The journal is not part of the export.

## Profile

`profile.json` is `{ nickname, avatar, created_at, achievements, counters, ach_seen }`. `achievements` maps an achievement id to the time it was received, `counters` counts actions the journal cannot see (`tray`, `export`, `import`, `restore`, `sgdb`), `ach_seen` is the time the profile page was last opened (what was received later is shown as "Новое"). The nickname is cleaned (control characters removed, spaces collapsed, 24 characters). The avatar (up to 2 MB, the usual image types) is copied to `icons/`, the old one is deleted only after the new one is saved. `created_at` is set on the first start: the first journal entry or the current time. A damaged file is renamed to `profile.corrupt-<date>.json`. Nothing is sent anywhere.

### Achievements

`achievements.js` holds the built-in set (28): each has an `id`, a group, a title, a condition text, a `goal` and a function `cur(ctx)` over the library, the statistics from the journal, the profile and the counters. It is received when `cur >= goal`. `main.js` checks them (with a 100 ms delay, once for many calls) after every library save, after a counted session, after a nickname or avatar change and after a counter changes. New ones are written to `profile.json` and sent to the page as the `achievement-unlocked` event. The first check after this feature appeared only records what is already done, without notices and without "Новое", so an old library does not produce a flood of toasts. A broken condition counts as 0 and does not affect the others.

A game removed from the library is not erased. `remove_game` appends `{ game, deleted_at }` to `trash.json` (the whole game record is kept as it was) and only then removes it from `games.json`; the image files stay in `icons/`. The order matters: if the second save fails, the game is taken out of the trash again, so a failure can never lose a game. The record is written like the library (temporary file, then rename).

- **Undo and return.** The "Отменить" button in the notice and "Вернуть" in Settings → Library call `restore_game`. The trash is saved first, then the game is added back with the same id (a new one if the id is taken) and its images; an image file that has disappeared is dropped, and the game comes back without it.
- **Deleting for good.** "Удалить навсегда" and "Очистить" call `delete_trash`: the trash is saved first, then the image files are deleted.
- **Automatic cleanup.** At startup and after each removal, entries older than 30 days and everything beyond the newest 50 are deleted for good with their images. If the trash cannot be saved, no image is touched.
- **Safety.** `trash.json` is not trusted: a damaged file or a record without a game id is ignored (an empty trash), it never affects `games.json`, and an image name is deleted only if it is a plain file name inside `icons/`. The trash is not part of the export ([Moving the library](transfer.md)) and not of the backups; a running game that is removed stops being counted for playtime.

## Reading and recovery

`loadGames()` distinguishes three situations:

| Situation | What happens |
|-----------|--------------|
| File read and parsed fine | The list is loaded. If it is not empty, a copy is stored in `backups/` (see below) |
| File is **locked or unreadable** (`EBUSY`, no access…) | The read is retried 4 times. If it still fails, an error is thrown and the app shows a dialog with **Retry** and **Exit**. It never continues with an empty list |
| File is **corrupted** (not JSON, or not an array) | The file is renamed to `games.corrupt-<date>.json` (never overwritten). The newest valid copy is restored: first `games.json.bak`, then `backups/` from newest to oldest. A notice tells the user what happened and where the corrupted file is. If no valid copy exists, the library starts empty, the corrupted file is kept, and the notice says so |
| File is **missing** | If there are no copies, this is a normal first start (empty library). If a copy exists, it is restored with a notice |

A UTF-8 BOM at the start of the file is tolerated.

The startup dialog loop also covers failures to create the data folder.

### Backups

- `games.json.bak` is the previous saved state. It changes on every save.
- `backups/` receives one copy per app start (only when the library is not empty). Only the newest 5 are kept; older ones are deleted.

Backups contain the game list only, not the image files. Images in `icons/` are not removed by recovery, so restored games keep their images as long as `icons/` is intact.

## Migration from GameLib

Older versions stored data in `%APPDATA%\gamelib` (or `GameLib`). On start, if the new `games.json` does not exist but the old one does, the old `games.json` and the `icons` folder are copied to the new location. The old folder is never modified or deleted.

## Duplicate protection

`add_game` and `update_game` reject a game whose file is already in the library. Paths are compared through a normalized key (`pathKey`):

1. On Windows, a `.lnk` shortcut is resolved to its target.
2. The real path is resolved (`realpathSync.native`) when the file exists.
3. The path is made absolute, and lower-cased on Windows (the file system is case-insensitive).

So `D:\Games\a.exe`, `d:/games/A.EXE` and a shortcut to it count as the same game.

## Moving the library

Copy the whole `manygamelib` folder (it carries the settings and the own wallpaper too). Game paths are absolute, so the games must be at the same paths on the other computer. A game whose file is missing is still listed and shows a "File not found" badge.
