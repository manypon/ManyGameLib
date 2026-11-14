# ManyGameLib

[English](README.md) | [Русский](README_RU.md)

A local game library for Windows, built with Electron. Add a game once (file path, icon, name) and launch it from the app from then on.

## Requirements

**Node.js** (LTS): https://nodejs.org. No compilers or build tools needed.

## Run

```powershell
npm install
npm start
```

Or double-click `start.bat`: it runs `npm install` for you.

## Build the app

Double-click `build.bat`: it closes a running copy of the app, installs dependencies, removes the old build and runs the build. Or by hand:

```powershell
npm run build
```

Output: the installer `dist\ManyGameLib-Setup-<version>.exe` and the portable folder `dist\win-unpacked\ManyGameLib.exe`. The whole `win-unpacked` folder can be moved anywhere, and Node.js is not needed to run it.

If Electron fails to download (a 504 or other network error), you can assemble the app by hand from an Electron build you already have: copy its `dist` folder as `ManyGameLib`, rename `electron.exe` to `ManyGameLib.exe`, and put `main.js`, `preload.js`, `updater.js`, `zip.js`, `sgdb.js`, `package.json`, `ui` and `build` into `resources\app`.

## Features

- On first launch the library is empty and the app asks you to add your first game: **game path**, **icon** (optional) and **name** (taken from the file or folder name by default).
- Grid and list views, search, sorting, favorites, recent games and a details view.
- **Editable top block.** When adding (or later via "Edit") you choose what the top of the library shows for the game: a blurred cover, your own banner image or a plain color as the background, a logo image instead of the title, and the cover on the right (cropped or shown whole). A live preview updates as you change options.
- **Playtime:** counted while the game you started is running (runs shorter than a minute are ignored), shown in the top block and in the details, sortable, and editable by hand.
- **Drag and drop:** drop `.exe`, `.jar`, `.lnk` and other game files into the window. The add form opens with the path, name and icon filled in; several files go one after another.
- **Icon from the game file:** for `.exe` and `.lnk` the icon is taken automatically when you add a game (or with the "From file" button); you can always pick your own picture.
- **Launch arguments** per game (for `.exe`, `.com` and `.jar`), for example `-windowed -nolauncher`.
- **Cover search:** the "Найти в SteamGridDB" button in the game form finds covers, banners, logos and icons (needs your own free SteamGridDB API key, stored encrypted on your computer).
- **Game menu:** besides launch, favorite, details and edit, it has "Показать в папке" (opens Explorer on the game file) and "Копировать путь".
- **Tags:** give a game your own tags ("Пройдено", "В планах", "Онлайн"…) in its form; the sidebar lists them with counts, and a click filters the library (several tags: games with all of them). Right-click a tag to rename or delete it.
- **Edit a game** at any time: name, file path, icon, banner, logo and top block settings (right-click a game, or "Details" then "Edit").
- Keyboard: Tab moves between games, Enter launches, Space selects.
- **Launching:** the Launch button, the play button on a tile (on hover), a double-click, or the right-click menu. While a game is running, its button shows "Играет" and it cannot be started a second time.
- **Tray:** the window's cross asks whether to hide the app to the tray or quit (with a "remember" checkbox, changeable in Settings). Autostart can open the app straight into the tray.
- **Settings page:** an app background (a bundled picture, your own or none) with blur and dimming sliders, an option to turn off the top block card, autostart with Windows, an optional log file, and a custom Java path for `.jar` files. The app background can be an animated GIF (up to 40 MB).
- **Updates:** the app checks GitHub for a newer version (can be turned off in Settings). With the installer it downloads and installs the update on your button; the portable folder only points you to the release page.
- **Profile:** a page with your nickname, an avatar (stored only on this computer), "in the library since" date and statistics: total time, last 7 and 30 days, a top of games and a daily chart. The periods come from a journal of play sessions that is kept from this version on; time played earlier counts only in the total. Below are 28 built-in achievements (library size, hours, sessions, day streaks, tags, using the tray, export and so on): locked ones are grey with the condition and progress, and a notice appears when you get one.
- Supported files: `.exe`, `.jar` (runs through Java, which must be installed; the app looks for `javaw` in PATH, `JAVA_HOME`, the Windows registry and the usual Program Files folders), `.lnk` and `.url` shortcuts, plus `.bat`, `.cmd` and `.msi`. Any other file opens with the program Windows has assigned to it.
- **Themes** (Settings → Appearance → "Стиль"): the usual look, **Glass** (a floating translucent sidebar and top bar, glass cards, windows and notices) and **New Year** (glass with a cold palette, a bundled winter background, falling snow and a string of lights; snow and lights can be turned off). Without an own background, soft colored blobs sit behind the glass.
- Each game can have a playthrough status (not started / playing / completed, shown as a badge on its tile) and a free note.
- Games start in their own folder, or in a working folder you choose for the game. If a game needs administrator rights, Windows shows the UAC prompt; a game can also be set to always run as administrator (its playtime is still counted).
- "Remove from library" asks nothing: the game goes to the trash for 30 days, and the notice has an "Отменить" button (Settings → Library can bring it back later or delete it for good). Your game files are never touched.
- If a game file is moved or deleted, its tile shows a "File not found" badge.

## Where your data is stored

`%USERPROFILE%\manypon\manygamelib\`

- `games.json`: the list of games
- `icons\`: copies of the icons you picked (they survive even if the original files are deleted)
- `profile.json`: your nickname and avatar name; `sessions.json`: the journal of play sessions (when and how long); `settings.json`: your settings (the app background copy is in `icons\`); `trash.json`: games removed in the last 30 days; `secrets.json`: the SteamGridDB key, encrypted by Windows, only if you add one; `logs\`: the log, only if you turn it on
- `games.json.bak`: the previous version of the list, updated on every save
- `backups\`: one copy of the list per app start, the last 5 are kept
- If `games.json` is corrupted, it is renamed to `games.corrupt-<date>.json` (never overwritten) and the last good copy is restored automatically, with a notice.
- If the file is locked by another program, the app offers "Retry" or "Exit" instead of starting with an empty library.

To move your library to another computer, use **Settings → Library → Export / Import** (a ZIP with the games and their images; import adds games and skips the ones already there), or copy that whole folder. Game paths are absolute, so the games need to be at the same paths there.

If you used the earlier GameLib version (data in `%APPDATA%\gamelib`), the library is copied to the new location automatically on first launch. The old folder is left untouched.

## Icons and covers

Best results with a 512×512 square or a 600×900 vertical cover (PNG, JPG, WEBP, ICO, BMP or GIF), up to 8 MB. The image is cropped to fit the tile, centered.

For the top block: a banner around 1920×620, and a logo as a PNG with a transparent background (up to about 520×130 on screen).

## Project structure

```
manygamelib/
├─ main.js        game storage, process launching, file dialogs
├─ preload.js     safe bridge between the UI and main.js
├─ updater.js     update check, download and install
├─ zip.js         ZIP reading and writing for library export and import
├─ sgdb.js        cover search in SteamGridDB
├─ ui/            interface (index.html, style.css, app.js, assets/)
├─ build/         app icons
├─ docs/          technical documentation
├─ start.bat      double-click launcher
└─ build.bat      double-click build
```

## Documentation

How the app works inside (architecture, storage and backups, settings, updates, images, launching, interface, build and release): [docs/](docs/README.md). Every page is in English and Russian.

## License

MIT
