# Moving the library

[English](transfer.md) | [Русский](transfer_RU.md)

[← Documentation index](README.md)

Settings → Library → "Перенос библиотеки" saves all games to one ZIP archive and adds games from such an archive. Use it to move to another computer or to keep a copy outside the data folder. The code is in `main.js` (`buildExport`, `mergeImport`, the commands `export_library` and `import_library`) and `zip.js`.

## What is in the archive

| File | Contents |
|------|----------|
| `manifest.json` | `app` (`ManyGameLib`), `format` (now `1`), `version` of the app, `exported_at`, number of games |
| `games.json` | The list of games: `name`, `exe_path`, `args`, `hero`, `favorite`, `last_played`, `playtime_sec`, `added_at`, and `icon_file`, `banner_file`, `logo_file` |
| `icons/` | The images of the games |

- Game ids are not exported: every import creates new ones.
- Image fields hold a path inside the archive (`icons/0-icon.png`), or `null` if the game has no such image or its file is missing on disk.
- Settings, the app background and backups are not part of the archive. Only the games.
- `exe_path` is written as it is. The games must be at the same paths on the other computer, otherwise they show "File not found" (see [Storage](storage.md)).

## Export

`export_library` opens the system "Save as" window (the page never gives a path), builds the archive in memory and writes it through a temporary file, so a failed write never leaves a broken `.zip`. The default name is `ManyGameLib-YYYY-MM-DD.zip` in Documents; `.zip` is added if missing. Cancelling returns `null`. An empty library gives an error.

## Import

`import_library` opens the system "Open" window and then:

1. Refuses files over 1 GB and anything that is not a valid ZIP.
2. Reads `manifest.json` (`app` must be `ManyGameLib`; a `format` newer than the app knows is refused with a hint to update) and `games.json` (must be a list).
3. Puts a copy of the current `games.json` into `backups\` (`games-…-before-import.json`).
4. Goes through the games one by one. A game is **skipped** if it is not an object, has no name or path, the path has control characters or is longer than 1000 characters, or the file path is already in the library (compared like in "add game", see `pathKey`) or earlier in the same archive.
5. Each added game gets a new id. `name`, `args`, `hero`, `playtime_sec` and the other fields go through the same cleaning as in the add form; broken values become defaults (for example `last_played` becomes `null`).
6. Images are copied from the archive to `icons\` under new names with the same checks as everywhere: only the extensions PNG, JPG, WEBP, ICO, BMP, GIF, at most 8 MB. An image that fails a check is not copied, and the game is still added without it (counted as "imagesLost").
7. All new games are saved with one `commit()`. If saving fails, the copied images are deleted and the library stays as it was.

The result is `{ added, skipped, imagesLost }`. The interface shows "Добавлено N, пропущено M" (and the number of lost images if there are any). Existing games are never changed or removed.

An imported entry is only data: nothing from the archive is run. But an imported game points to a file on your computer, and starting it starts that file, so import only archives you trust.

## Reading a ZIP safely

An archive is untrusted input. `zip.js` (about 170 lines, only built-in `zlib`) is strict:

- Files are never written to a path taken from the archive. Image names inside the archive must match `icons/<letters, digits, . _ ->`, and the file on disk gets a name made by the app. So `..`, absolute paths and drive letters cannot reach the file system.
- Sizes are checked before anything is unpacked: at most 20000 entries, 32 MB per file, 2 GB in total.
- Unpacking is limited to the size announced in the archive (`maxOutputLength`), so a "zip bomb" that lies about its size fails. After unpacking, the length and the CRC-32 are checked.
- Not supported and refused: encryption, ZIP64, multi-volume archives, compression other than "stored" and deflate.
- The writer and the reader were also checked against Python's `zipfile` in both directions, so ordinary tools can open the archive.

## Code map

| File | What is there |
|------|---------------|
| `zip.js` | `writeZip(entries)`, `readZip(buffer, limits)`, `crc32` |
| `main.js` | `buildExport`, `mergeImport`, `export_library`, `import_library` |
| `preload.js` | the two commands in the whitelist |
| `ui/app.js` | the "Перенос библиотеки" card on the Library tab (`transfer`) |

Related: [Storage](storage.md), [Images](images.md), [Settings](settings.md), [Architecture](architecture.md).
