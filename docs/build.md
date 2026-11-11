# Build, run and release

[English](build.md) | [Русский](build_RU.md)

## Requirements

Node.js (LTS). No compilers or native build tools: the app has no native modules. Electron, electron-builder and `rcedit` are the dev dependencies. The only runtime dependency is `electron-updater` (see [Updates](updates.md)).

## Running from source

```powershell
npm install
npm start          # runs: electron .
```

`start.bat` does the same by double-click: it runs `npm install` if `node_modules` is missing, then starts `node_modules\electron\dist\electron.exe .`.

## Building

```powershell
npm run build      # runs: electron-builder
```

or double-click `build.bat`. The script:

1. Closes a running `ManyGameLib.exe` (an open copy locks its own file and the build fails with `EPERM ... unlink`).
2. Runs `npm install` only if `node_modules` is missing.
3. Deletes the old `dist` folder.
4. Runs `npm run build` and opens the result folder.

Output:

- `dist\ManyGameLib-Setup-<version>.exe`: the installer.
- `dist\win-unpacked\ManyGameLib.exe`: the portable folder. It can be moved or zipped; Node.js is not needed to run it.

The build script is `electron-builder --publish never`: publishing is done by the workflow, never by `npm run build` itself.

### The `build` section of `package.json`

| Setting | Value | Why |
|---------|-------|-----|
| `appId` / `productName` | `com.manygamelib.app` / `ManyGameLib` | Identity and the exe name |
| `files` | `main.js`, `preload.js`, `updater.js`, `ui/**/*`, `build/**/*` (without `build/afterPack.js`) | Only what the app needs ends up in the package |
| `afterPack` | `build/afterPack.js` | Writes the icon and version info into the exe (see below) |
| `publish` | GitHub, `manypon/ManyGameLib` | Makes electron-builder write `latest.yml` and `app-update.yml` for the updater; nothing is published by the build |
| `electronDist` | `node_modules/electron/dist` | Reuse the Electron already installed by `npm install` instead of downloading it again at build time |
| `directories.output` | `dist` | Build output folder |
| `win.target` | `dir`, `nsis` | The unpacked folder (the portable version) and an NSIS installer |
| `nsis` | see below | Installer behavior |
| `win.icon` | `build/icon.ico` | App icon |
| `win.signAndEditExecutable` | `false` | Skips electron-builder's own exe editing, which needs winCodeSign and symbolic-link rights and fails with `EPERM` on a normal Windows account. `afterPack` does the job instead |

### The exe icon: `afterPack`

With `signAndEditExecutable: false` the exe would keep Electron's default atom icon, and Windows shortcuts, search and the taskbar take the icon from the exe. `build/afterPack.js` runs after the app is assembled and, with the `rcedit` package, writes `build/icon.ico` and the product name, version and copyright into `ManyGameLib.exe`. It needs no downloads. If a shortcut still shows an old icon after an update, it is Windows' icon cache; it refreshes after a restart.

### The installer

`nsis` settings: `oneClick: false` (the user can choose the folder), `perMachine: false` (installs for the current user, no administrator rights needed), desktop and Start menu shortcuts, and `artifactName` `ManyGameLib-Setup-${version}.exe`. `deleteAppDataOnUninstall` is `false`, and the library lives in `%USERPROFILE%\manypon\manygamelib` anyway, outside the install folder, so updating or uninstalling does not remove games, images or settings.

The installer is not code-signed, so Windows SmartScreen may warn on the first run ("More info" then "Run anyway"). NSIS tools are downloaded by electron-builder on the first build, so the first local build needs network access to GitHub.

### If Electron does not download

`npm install` downloads Electron from GitHub. If that fails (for example with a 504), you can assemble the app by hand from an Electron build you already have: copy its `dist` folder as `ManyGameLib`, rename `electron.exe` to `ManyGameLib.exe`, and put `main.js`, `preload.js`, `package.json`, `ui` and `build` into `resources\app`.

## Versions and commits

- The version is in `package.json` and follows semantic versioning: a patch number (1.1.x) for fixes, a minor number (1.x.0) for new features. The UI reads it from the main process (`get_version`), so there is only one place to change.
- Commit messages follow Conventional Commits with a short lowercase title and no body, for example `fix: block repeated game launch` or `perf: debounce library search`.
- Contribution rules (bug reports, branches, pull requests) are in `CONTRIBUTING.md`.

## Automated build and release (GitHub Actions)

Two workflows live in `.github/workflows/`.

### `build.yml`: build and publish

Runs when a tag starting with `v` is pushed (for example `v1.1.1`), or manually from the Actions tab (`workflow_dispatch`). On `windows-latest` it:

1. Checks out the repository and sets up Node.js 20 with the npm cache.
2. Runs `npm install` with `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`. The mirror avoids the failed Electron downloads from GitHub (the 504 errors mentioned above).
3. Runs `node node_modules/electron/install.js` to make sure the Electron binary is really there, because `electronDist` in `package.json` points at it.
4. Runs `npm run build`.
5. Uploads `dist/win-unpacked/` as a workflow artifact named `ManyGameLib-Windows`, and the installer as `ManyGameLib-Installer`.
6. Zips the contents of `dist/win-unpacked/` into `ManyGameLib-Build.zip` and attaches it to the release together with `ManyGameLib-Setup-<version>.exe`, its `.blockmap` and `latest.yml` (the last two are what the updater needs) for the tag (`softprops/action-gh-release`, with `contents: write` permission and the built-in `GITHUB_TOKEN`).

Things to know:

- The zip holds the *contents* of `win-unpacked` directly (no top-level folder), so users should unpack it into a folder of their own.
- A manual run is not tied to a tag: the release name then comes from the branch name (`github.ref_name`). Use tags for real releases.

### `state.yml`: stale issues

Runs every day at 00:00 UTC (and manually). An issue with no activity for 30 days gets a comment asking whether it is still relevant (the text is in Russian); it is closed 7 days later if nobody answers. Issues labeled `bug` or `enhancement` are never touched.

## Making a release

1. Make sure `package.json` has the new version (it is changed once, in the first commit of the release).
2. Test the build locally with `build.bat` if you can.
3. Create and push a tag: `git tag v1.1.1` then `git push origin v1.1.1`.
4. Wait for the `Build Electron App` workflow; it creates the release with `ManyGameLib-Setup-<version>.exe` and `ManyGameLib-Build.zip`.
5. Edit the release description: what is new and how to install, in English and Russian.

## Project layout

```
manygamelib/
├─ main.js         main process
├─ preload.js      bridge between the UI and main.js
├─ ui/             index.html, style.css, app.js
│  └─ assets/      wallpaper-default.webp (default app background)
├─ build/          icon.png, icon.ico
├─ docs/           this documentation
├─ .github/        GitHub Actions workflows
├─ CONTRIBUTING.md how to contribute
├─ start.bat       run from source
├─ build.bat       build the app
└─ package.json    scripts, dependencies, electron-builder settings
```
