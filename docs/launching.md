# Launching games

[English](launching.md) | [Русский](launching_RU.md)

Launching is handled entirely by the main process (`spawnGame()` in `main.js`). The UI only sends `launch_game { id }`.

## What happens on `launch_game`

1. Find the game; fail if the id is unknown.
2. If this game was launched less than 3 seconds ago, return immediately without launching again (see "Repeat protection").
3. If the file no longer exists, fail with "file not found".
4. Mark the launch time, then start the process.
5. On failure, clear the mark (so the user can retry at once) and report the error.
6. On success, set `last_played` to now, save the library, start following the process for playtime (see below) and return the updated game.

## How each file type is started

| Extension | Method |
|-----------|--------|
| `.exe`, `.com` | `spawn` the file directly with the game's launch arguments, with the game's own folder as the working directory. If that fails (for example, Windows requires elevation) and there are no arguments, fall back to the shell (`shell.openPath`), which shows the UAC prompt |
| `.jar` | Find `javaw.exe` (see below) and run `javaw -jar <file> <arguments>` in the file's folder |
| everything else (`.lnk`, `.url`, `.bat`, `.cmd`, `.msi`, other files) | `shell.openPath`: the program Windows has assigned to the file type |

## Launch arguments

A game can have launch arguments (`args`), for example `-windowed -nolauncher`. They are used for `.exe`, `.com` and `.jar` only; the field is hidden in the form for other types, and ignored for them if a value is stored.

- The string is split into words by spaces; text in double quotes stays one word (`-path "C:\My Games"` gives `-path` and `C:\My Games`). An unclosed quote takes the rest of the line (`parseArgs`).
- The words are passed to the process as a list, never through a command shell. Characters like `&` or `|` are ordinary text, so an argument cannot run another command.
- For `.jar` the arguments follow `-jar <file>`. JVM options (such as `-Xmx4G`) are not supported: they would have to come before `-jar`.
- If the direct start fails and the game has arguments, the shell fallback is **not** used (it cannot pass arguments), and the error says to start the game without arguments or manually. This matters for games that require administrator rights.
- The log records `[with arguments]` but never their content, because arguments may contain tokens.

Processes are started **detached** with ignored stdio and `unref()`, so a game keeps running if ManyGameLib is closed, and its output never blocks the launcher. The working directory is the game's folder, because many games load files by relative paths.

## Java for `.jar`

The app looks for `javaw.exe` in this order and uses the first one that exists:

0. The path set in Settings (`javaPath`, see [Settings](settings.md)). If it is set, **only** this file is used: a wrong path is an explicit error ("Java file from settings not found"), never a silent switch to another Java.
1. Every folder in `PATH`.
2. `JAVA_HOME\bin` and `JRE_HOME\bin`.
3. The Windows registry:
   - the command bound to `.jar` files (`HKCR\jarfile\shell\open\command`). Its path is used only if it points to `javaw.exe`; if `.jar` is bound to an archiver, it is ignored;
   - `JavaHome` values under `HKLM\SOFTWARE\JavaSoft` and `HKLM\SOFTWARE\WOW6432Node\JavaSoft`.
4. Common install folders inside Program Files (and the x86 / W6432 variants): `Java`, `Eclipse Adoptium`, `Microsoft`, `Zulu`, `BellSoft`, `Amazon Corretto`, `Semeru`, `Temurin`. When several versions are installed, the newest wins. Versions are compared as numbers taken from the folder name, and the old `1.8` style counts as Java 8 (so `jdk-17` beats `jre1.8.0_300`).

Registry reads use `reg query` with a 4-second timeout and are skipped on non-Windows systems.

If nothing is found, the user gets a clear message ("Java not found. Install Java (JRE 8 or newer) or set JAVA_HOME") and **nothing else is opened**. The app deliberately does not fall back to the Windows file association, because on many PCs `.jar` is bound to an archiver, which would open the file as an archive instead of running it.

## Playtime

The time spent in a game is counted automatically, in `playtime_sec`.

- **What is counted.** The time from the start of the process that ManyGameLib started (the game `.exe`, `.com`, or `javaw` for a `.jar`) until that process exits. Its `exit` event ends the session and the seconds are added to the game and saved (the page is told with the `game-updated` event).
- **Sessions shorter than 60 seconds are ignored**, so a game that crashed at once or a launcher that opens and closes does not add noise.
- **One session per game.** If a second copy is started while the first is still running, only the first process defines the session, so the time is not doubled.
- **Closing ManyGameLib during a game.** The game keeps running; on exit (`before-quit`) the time up to that moment is saved. What the game is played afterwards is not counted. A crash of ManyGameLib loses the running session.
- **Not counted at all:** games started through the Windows shell (`.lnk`, `.url`, `.bat`, `.cmd`, `.msi`, and an `.exe` that needed the UAC fallback), because there is no process to follow. Launchers that start the real game and quit are counted only as long as the launcher runs. For these the value can be set by hand.
- **By hand.** The edit and add forms have a field "Наиграно, ч" (hours, decimals with a comma or a point). `add_game` and `update_game` accept `playtimeSec`: a number sets the value, `undefined`, `null` or an empty value leaves it as it is, and an invalid number is rejected ("Время в игре задано неверно."). The form sends the value only if the user touched the field, so the automatic value is not overwritten by the rounding of the displayed hours.
- **Display.** `12,5 h` style: one decimal up to 100 hours, whole hours above, "меньше 0,1 ч" for tiny values. It is shown in the top block, in the "About" window and as the sort "По времени в игре".

## Repeat protection

Double-clicking must not start a game twice, so there are two layers:

- **Main process.** A map `game id → launch time`. A request for the same game within `LAUNCH_LOCK_MS` (3000 ms) is ignored and returns the current game state. The time is recorded *before* the process is started, so two requests arriving together cannot both pass. A failed launch removes the record. This guards against any source of repeated calls, even ones the UI does not know about.
- **Interface.** `launching` marks the game as busy for the same 3 seconds. All launch buttons for that game (the big button, the tile's ▶, the list button) become disabled and the big button reads "Запускается…". A failed launch unlocks immediately. The lock survives re-renders because buttons are re-marked after every render.

Other games are never blocked by the lock.

The lock lives in memory only; restarting the app resets it.

## Missing files

`view()` marks a game `missing` when its file does not exist. Tiles show a "File not found" badge. The UI re-checks cheaply (`get_missing` returns just the ids) each time the window regains focus, so plugging in a drive or restoring a file clears the badge without a restart.

## Log

When logging is enabled in Settings, every launch, the chosen Java and every launch error are written to `logs\manygamelib.log` (see [Settings](settings.md)).

## Limits

- "Launched" means the process started, not that the game finished loading. Play time is not tracked.
- Launchers that start the real game through another process are fine to run, but the app only knows about the first process.
