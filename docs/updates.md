# Updates

[English](updates.md) | [Русский](updates_RU.md)

[← Documentation index](README.md)

ManyGameLib can check GitHub for a newer version and, when it was installed with the installer, download and install it. All of this lives in `updater.js` (main process). The interface only sees a small state object and a few commands.

## Two modes

The mode is chosen once at startup:

| Mode | When | What the app does |
|------|------|-------------------|
| `installer` | The app is packaged and `Uninstall <exe name>.exe` lies next to the exe (the NSIS installer puts it there) | Checks, downloads and installs the update itself with `electron-updater` |
| `manual` | Portable folder (`win-unpacked`, the zip) or running from source | Only tells the user that a newer version exists and opens the release page |

A portable folder is not updated by the app on purpose: replacing the files of a running program in an arbitrary folder is unreliable, and the user may have moved or renamed it.

## Checking

- **`installer`**: `autoUpdater.checkForUpdates()` reads `latest.yml` from the latest GitHub release.
- **`manual`**: a request to `https://api.github.com/repos/manypon/ManyGameLib/releases/latest` made by the main process (`net.fetch`, 10 s timeout). The tag (`v1.4.0`) is compared with the current version by `cmpVersion()` (numbers only, so `1.10.0` is newer than `1.9.9`).

Pre-releases and drafts are never offered: GitHub's `latest` endpoint skips them, and `electron-updater` is left on its default.

A check runs when the user presses "Check", and once about 4 seconds after startup when "Check on startup" is on (setting `checkUpdates`, on by default). Parallel checks are merged into one request. Failures (no network, a rate limit, a release without `latest.yml`) become an error status with a short message (`shortError()` cuts the long text `electron-updater` produces); they never block anything.

## Downloading and installing (`installer` mode)

Nothing is downloaded or installed on its own: `autoDownload` and `autoInstallOnAppQuit` are both `false`.

1. "Download" calls `downloadUpdate()`. The state becomes `downloading` and the interface shows a progress bar.
2. When the file is downloaded and its checksum (SHA-512 from `latest.yml`) is verified, the state becomes `ready`.
3. "Install and restart" calls `quitAndInstall(true, true)`: a silent install, then the new version starts.

The library, images and settings are in `%USERPROFILE%\manypon\manygamelib`, outside the install folder, so an update does not touch them.

The installer is not code-signed. The update is checked against the checksum published in the same release, which protects against a damaged download but not against someone who controls the release itself (code signing would add that).

## State

`updater.getState()` returns:

| Field | Meaning |
|-------|---------|
| `status` | `idle`, `checking`, `none` (up to date), `available`, `downloading`, `ready`, `error` |
| `mode` | `installer` or `manual` |
| `current` | The running version |
| `version` | The newer version that was found |
| `progress` | 0–100 while downloading |
| `error` | A message when `status` is `error` |

Every change is also pushed to the page as the `update-state` event (`window.api.onUpdateState`). While downloading, the page moves only the progress bar instead of redrawing the whole screen. When a background check finds a new version, a toast points to Settings → About.

## Commands

| Command | Returns |
|---------|---------|
| `get_update_state` | The state |
| `check_update` | The state after the check |
| `download_update` | The state (`downloading`); refused in `manual` mode or before a check found something |
| `install_update` | nothing; refused unless the status is `ready` |

`open_external` with the keyword `release` opens `https://github.com/manypon/ManyGameLib/releases/latest`.

## What the release needs

`electron-updater` finds the update through files attached to the GitHub release. The build workflow attaches all of them:

| File | Purpose |
|------|---------|
| `ManyGameLib-Setup-<version>.exe` | The installer, also the update payload |
| `ManyGameLib-Setup-<version>.exe.blockmap` | Lets the updater download only the changed parts |
| `latest.yml` | The version, file name and SHA-512 of the installer. electron-builder writes it into `dist` next to the installer even with `--publish never`. The workflow only creates it if it is missing (step "Ensure latest.yml exists", a safety net) |
| `ManyGameLib-Build.zip` | The portable version (not used by the updater) |

`package.json` has `build.publish` (GitHub, `manypon/ManyGameLib`), which makes electron-builder write `latest.yml` and `resources\app-update.yml` (where the installed app reads its update source). The build itself runs with `--publish never`; attaching the files to the release is the workflow's job. See [Build](build.md).

## Code map

| Where | What |
|-------|------|
| `updater.js` | `createUpdater`, `cmpVersion`, both modes |
| `main.js` | Creates the updater, the four commands, the delayed check after startup |
| `preload.js` | The four commands and `onUpdateState` |
| `ui/app.js` | `updatesCard`, `onUpdateState`, the "Updates" card in Settings → About |

Related: [Settings](settings.md), [Build](build.md), [Architecture](architecture.md).
