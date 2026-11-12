# Cover search (SteamGridDB)

[English](sgdb.md) | [Русский](sgdb_RU.md)

[← Documentation index](README.md)

The "Найти в SteamGridDB" button in the game form searches [SteamGridDB](https://www.steamgriddb.com) for covers, banners, logos and icons. The code is in `sgdb.js` (loaded by `main.js`), the window is `openSgdbPanel` in `ui/app.js`.

## The API key

SteamGridDB requires a personal key. It is free: register on the site and copy it from the profile ("Preferences → API"). The app never ships with a key, and a key must never be committed to the repository.

- The key is pasted either in the search window (it asks when there is no key) or in Settings → Library → SteamGridDB.
- It is stored in `secrets.json` in the data folder, **encrypted with Electron `safeStorage`** (on Windows this is DPAPI: only your Windows account can decrypt it). If encryption is not available, the key is not saved at all.
- It is kept apart from `settings.json`, so it is not in the settings reset, and it is not part of the library export ([Moving the library](transfer.md)).
- The page never sees the key. The command `sgdb_state` only says `{ hasKey }`. The key is not written to the log either.
- A new key is checked with a test request. A key that SteamGridDB rejects (401 or 403) is not saved. If there is no connection, the key is saved and the app says it could not check it.
- "Удалить ключ" in settings deletes the file.

## What the search does

1. `sgdb_search { term }`: `GET /search/autocomplete/<name>`, up to 12 games.
2. `sgdb_images { gameId, kind }`: `GET /<section>/game/<id>`, up to 36 pictures with `url`, `thumb`, size and style.

| Tab | API section | Fills the field |
|-----|-------------|-----------------|
| Обложка | `grids` (600×900, 342×482, 660×930) | icon or cover |
| Баннер | `heroes` | banner |
| Логотип | `logos` | logo |
| Иконка | `icons` | icon or cover |

NSFW and humor are always turned off, and only PNG, JPEG and WEBP are requested (PNG and WEBP for logos and icons). The window opens with the game name from the form already searched; the first match is selected.

3. A click on a picture runs `sgdb_download { url }`. The main process downloads it to a temporary file (`manygamelib-sgdb` in the system temp folder; old files are removed at the next download and at startup) and returns its path and a preview. From here the form treats it exactly like a file chosen with "Обзор…": the picture is copied into `icons\` only when the game is saved, with the usual checks (type, 8 MB). If the form is cancelled, nothing is added to the library.

## Safety

- All network requests are made by the main process. The page can only ask for the six commands in the whitelist.
- Only `https` addresses on `steamgriddb.com` and its subdomains can be downloaded, which is checked on every address from the list and again on download (a look-alike such as `steamgriddb.com.evil.com` or `steamgriddb.com@evil.com` is refused). Redirects are not followed.
- The key goes only to the API (`Authorization: Bearer …`). It is not sent when downloading a picture from the CDN.
- The file type is decided by its first bytes (PNG, JPEG, WEBP, GIF), not by what the server says. A page that is not a picture, or a file over 8 MB, is refused.
- The CSP of the page allows thumbnails only from `https://*.steamgriddb.com` (`img-src 'self' data: https://*.steamgriddb.com`). Nothing else on the internet can be loaded into the page.
- Timeouts: 15 seconds for the API, 30 for a picture. Errors are shown in plain words: no key, key rejected, too many requests, no connection, no answer in time.

## Limits

- Pictures belong to their authors and to SteamGridDB. The window says where they come from; check the terms of the site if you share your library.
- Search needs an internet connection and a working SteamGridDB. The rest of the app works without them.
