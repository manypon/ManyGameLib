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
  "icon_file": "1731234567890-icon-m3k2x9.png",
  "banner_file": null,
  "logo_file": null,
  "hero": { "bg": "blur", "art": true, "fit": "cover" },
  "favorite": false,
  "last_played": 1731300000000,
  "added_at": 1731234567890
}
```

- `id` is the creation time in milliseconds as a string. If it is already taken, it is incremented until it is unique.
- `name` is trimmed and cut to 80 characters.
- `*_file` fields hold only a file name inside `icons/`, never a path, so the folder can be moved to another computer.
- `hero` is normalized on every read: unknown values fall back to `blur`, `true` and `cover` (see [Images](images.md)).
- `exe_path` is an absolute path as chosen by the user.
- Times are Unix milliseconds.

## Writing safely

`saveGames()` follows this order:

1. Write the whole list to `games.json.tmp`.
2. Copy the current `games.json` to `games.json.bak`.
3. Rename the temporary file over `games.json`.

A crash during step 1 leaves the real file untouched. The rename in step 3 is atomic on the same volume, so `games.json` is always either the old or the new complete file. The rename is retried a few times (waits of 150, 300 and 450 ms) for the errors that antivirus or cloud-sync software causes (`EBUSY`, `EPERM`, `EACCES`, and similar).

### `commit()` and rollback

Changes that add or edit a game go through `commit(next)`: it swaps the in-memory list, saves, and if saving fails puts the old list back. Memory and disk therefore never disagree. Image files copied for the change are deleted again if the save fails (see [Images](images.md)).

Simple changes (`toggle_favorite`, the `last_played` update after a launch, `remove_game`) call `saveGames()` directly.

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
