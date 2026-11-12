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

If Electron fails to download (a 504 or other network error), you can assemble the app by hand from an Electron build you already have: copy its `dist` folder as `ManyGameLib`, rename `electron.exe` to `ManyGameLib.exe`, and put `main.js`, `preload.js`, `updater.js`, `zip.js`, `package.json`, `ui` and `build` into `resources\app`.

## Features

- On first launch the library is empty and the app asks you to add your first game: **game path**, **icon** (optional) and **name** (taken from the file or folder name by default).
- Grid and list views, search, sorting, favorites, recent games and a details view.
- **Editable top block.** When adding (or later via "Edit") you choose what the top of the library shows for the game: a blurred cover, your own banner image or a plain color as the background, a logo image instead of the title, and the cover on the right (cropped or shown whole). A live preview updates as you change options.
- **Playtime:** counted while the game you started is running (runs shorter than a minute are ignored), shown in the top block and in the details, sortable, and editable by hand.
- **Drag and drop:** drop `.exe`, `.jar`, `.lnk` and other game files into the window. The add form opens with the path, name and icon filled in; several files go one after another.
- **Icon from the game file:** for `.exe` and `.lnk` the icon is taken automatically when you add a game (or with the "From file" button); you can always pick your own picture.
- **Launch arguments** per game (for `.exe`, `.com` and `.jar`), for example `-windowed -nolauncher`.
- **Edit a game** at any time: name, file path, icon, banner, logo and top block settings (right-click a game, or "Details" then "Edit").
- Keyboard: Tab moves between games, Enter launches, Space selects.
- **Launching:** the Launch button, the play button on a tile (on hover), a double-click, or the right-click menu.
- **Settings page:** an app background (a bundled picture, your own or none) with blur and dimming sliders, an option to turn off the top block card, autostart with Windows, an optional log file, and a custom Java path for `.jar` files.
- **Updates:** the app checks GitHub for a newer version (can be turned off in Settings). With the installer it downloads and installs the update on your button; the portable folder only points you to the release page.
- Supported files: `.exe`, `.jar` (runs through Java, which must be installed; the app looks for `javaw` in PATH, `JAVA_HOME`, the Windows registry and the usual Program Files folders), `.lnk` and `.url` shortcuts, plus `.bat`, `.cmd` and `.msi`. Any other file opens with the program Windows has assigned to it.
- Games start in their own folder. If a game needs administrator rights, Windows shows the UAC prompt.
- "Remove from library" deletes only the library entry. Your game files are never touched.
- If a game file is moved or deleted, its tile shows a "File not found" badge.

## Where your data is stored

`%USERPROFILE%\manypon\manygamelib\`

- `games.json`: the list of games
- `icons\`: copies of the icons you picked (they survive even if the original files are deleted)
- `settings.json`: your settings (the app background copy is in `icons\`); `logs\`: the log, only if you turn it on
- `games.json.bak`: the previous version of the list, updated on every save
- `backups\`: one copy of the list per app start, the last 5 are kept
- If `games.json` is corrupted, it is renamed to `games.corrupt-<date>.json` (never overwritten) and the last good copy is restored automatically, with a notice.
- If the file is locked by another program, the app offers "Retry" or "Exit" instead of starting with an empty library.

To move your library to another computer, copy that whole folder. Game paths are absolute, so the games need to be at the same paths there.

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
