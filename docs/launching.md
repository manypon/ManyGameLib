# Launching games

[English](launching.md) | [Русский](launching_RU.md)

Launching is handled entirely by the main process (`spawnGame()` in `main.js`). The UI only sends `launch_game { id }`.

## What happens on `launch_game`

1. Find the game; fail if the id is unknown.
2. If this game was launched less than 3 seconds ago, return immediately without launching again (see "Repeat protection").
3. If the file no longer exists, fail with "file not found".
4. Mark the launch time, then start the process.
5. On failure, clear the mark (so the user can retry at once) and report the error.
6. On success, set `last_played` to now, save the library and return the updated game.

## How each file type is started

| Extension | Method |
|-----------|--------|
| `.exe`, `.com` | `spawn` the file directly, with the game's own folder as the working directory. If that fails (for example, Windows requires elevation), fall back to the shell (`shell.openPath`), which shows the UAC prompt |
| `.jar` | Find `javaw.exe` (see below) and run `javaw -jar <file>` in the file's folder |
| everything else (`.lnk`, `.url`, `.bat`, `.cmd`, `.msi`, other files) | `shell.openPath`: the program Windows has assigned to the file type |

Processes are started **detached** with ignored stdio and `unref()`, so a game keeps running if ManyGameLib is closed, and its output never blocks the launcher. The working directory is the game's folder, because many games load files by relative paths.

## Java for `.jar`

The app looks for `javaw.exe` in this order and uses the first one that exists:

1. Every folder in `PATH`.
2. `JAVA_HOME\bin` and `JRE_HOME\bin`.
3. The Windows registry:
   - the command bound to `.jar` files (`HKCR\jarfile\shell\open\command`). Its path is used only if it points to `javaw.exe`; if `.jar` is bound to an archiver, it is ignored;
   - `JavaHome` values under `HKLM\SOFTWARE\JavaSoft` and `HKLM\SOFTWARE\WOW6432Node\JavaSoft`.
4. Common install folders inside Program Files (and the x86 / W6432 variants): `Java`, `Eclipse Adoptium`, `Microsoft`, `Zulu`, `BellSoft`, `Amazon Corretto`, `Semeru`, `Temurin`. When several versions are installed, the newest wins. Versions are compared as numbers taken from the folder name, and the old `1.8` style counts as Java 8 (so `jdk-17` beats `jre1.8.0_300`).

Registry reads use `reg query` with a 4-second timeout and are skipped on non-Windows systems.

If nothing is found, the user gets a clear message ("Java not found. Install Java (JRE 8 or newer) or set JAVA_HOME") and **nothing else is opened**. The app deliberately does not fall back to the Windows file association, because on many PCs `.jar` is bound to an archiver, which would open the file as an archive instead of running it.

## Repeat protection

Double-clicking must not start a game twice, so there are two layers:

- **Main process.** A map `game id → launch time`. A request for the same game within `LAUNCH_LOCK_MS` (3000 ms) is ignored and returns the current game state. The time is recorded *before* the process is started, so two requests arriving together cannot both pass. A failed launch removes the record. This guards against any source of repeated calls, even ones the UI does not know about.
- **Interface.** `launching` marks the game as busy for the same 3 seconds. All launch buttons for that game (the big button, the tile's ▶, the list button) become disabled and the big button reads "Запускается…". A failed launch unlocks immediately. The lock survives re-renders because buttons are re-marked after every render.

Other games are never blocked by the lock.

The lock lives in memory only; restarting the app resets it.

## Missing files

`view()` marks a game `missing` when its file does not exist. Tiles show a "File not found" badge. The UI re-checks cheaply (`get_missing` returns just the ids) each time the window regains focus, so plugging in a drive or restoring a file clears the badge without a restart.

## Limits

- "Launched" means the process started, not that the game finished loading. Play time is not tracked.
- Launchers that start the real game through another process are fine to run, but the app only knows about the first process.
