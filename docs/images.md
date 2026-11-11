# Images and the top block

[English](images.md) | [Русский](images_RU.md)

Each game can have up to three images and a few top-block settings. This page explains how images are stored, sent to the UI and kept consistent with the library.

## Kinds of images

| Kind | Field in `games.json` | Used for |
|------|-----------------------|----------|
| `icon` | `icon_file` | Tile cover, list icon, the cover on the right of the top block |
| `banner` | `banner_file` | Optional background of the top block |
| `logo` | `logo_file` | Optional logo shown instead of the title text |

Accepted formats: PNG, JPG/JPEG, WEBP, ICO, BMP, GIF. Maximum size: **8 MB** per file. These checks run in the main process for every image, whatever the UI did.

## Copies, not links

When the user picks an image, it is **copied** into the `icons` folder of the library. The original can be deleted or moved later and the game keeps its picture.

File names look like `<gameId>-<kind>-<random>.<ext>`, for example `1731234567890-icon-m3k2x9.png`. The random part (the current time in base 36) makes a new name every time an image is replaced, so the UI never shows a stale cached picture. Older libraries may contain names without the random part (`<id>.<ext>`); they still work.

## Changing images: `keep`, `set`, `clear`

`add_game` and `update_game` receive an `images` object. Each kind has a `mode`:

```js
images: {
  icon:   { mode: 'set',   path: 'C:\\pics\\cover.png' },
  banner: { mode: 'keep' },
  logo:   { mode: 'clear' }
}
```

| Mode | Result |
|------|--------|
| `keep` (or missing) | The current file name stays |
| `set` | The file at `path` is validated and copied; its name replaces the old one |
| `clear` | The field becomes `null` |

`applyImages()` does the work and returns three things: the new field values, the files it **created**, and the files that became **obsolete** (replaced or cleared).

Consistency rules:

- If anything fails while copying (bad format, too large, copy error), every file created so far is deleted and the whole request fails. Nothing is half-applied.
- If saving `games.json` fails after the copy, the created files are deleted (the list rolls back, see [Storage](storage.md)).
- Obsolete files are deleted only **after** the library was saved successfully. A failed save never loses the old picture.
- `remove_game` deletes the game's image files after saving the list. It never touches the game's own files.

## Sending images to the page

Images are sent as `data:` URLs (base64), which is why the CSP allows `img-src data:`.

- `get_games` returns a light view of each game: the **icon** as a data URL, and only `has_banner` and `has_logo` flags for the heavy images.
- When a game becomes the one shown in the top block, the UI asks for its banner and logo with `get_assets` and caches them in memory. The top block re-renders when they arrive.
- `preview_image` turns a file picked in the form into a data URL before anything is saved, so the form can show a preview.

This keeps the main list small even with large banners.

## Top-block settings (`hero`)

| Field | Values | Meaning |
|-------|--------|---------|
| `bg` | `blur`, `banner`, `color` | Background: the blurred icon, the banner image, or a color gradient generated from the game name |
| `art` | `true` / `false` | Show the cover on the right side of the block |
| `fit` | `cover`, `contain` | Crop the cover to fill its frame, or show it whole |

`normalizeHero()` runs on every save and read, so invalid or missing values become `blur`, `true`, `cover`. If `bg` is `banner` but there is no banner image, the form refuses to save and asks for a picture or another background.

The app background (the picture behind the whole interface) is separate from game images: it is a bundled picture or the user's own copy `icons\app-wallpaper-<random>.<ext>`, see [Settings](settings.md). The top-block background described here can be switched off in Settings (`heroBackground`); the game's saved `hero` values stay untouched.

Without an icon, a game gets a colored tile with its first letter. The hue is derived from the name, so it stays the same between runs.

## Form behavior

The add/edit form keeps, for each image, `{ url, mode, path }`: what is shown now, and what to do on save. A live preview of the top block uses the same rendering code as the real block (marked as preview, with launch buttons disabled), so what the user sees is what will be saved.
