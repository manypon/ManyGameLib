# Сборка, запуск и релиз

[English](build.md) | [Русский](build_RU.md)

## Требования

Node.js (LTS). Компиляторы и нативные инструменты сборки не нужны: нативных модулей в приложении нет. Dev-зависимости: Electron, electron-builder и `rcedit`. Единственная runtime-зависимость это `electron-updater` (см. [Обновления](updates_RU.md)).

## Запуск из исходников

```powershell
npm install
npm start          # выполняет: electron .
```

`start.bat` делает то же двойным кликом: выполняет `npm install`, затем запускает `node_modules\electron\dist\electron.exe .`.

## Сборка

```powershell
npm run build      # выполняет: electron-builder
```

или двойной клик по `build.bat`. Скрипт:

1. Закрывает запущенный `ManyGameLib.exe` (открытая копия блокирует собственный файл, и сборка падает с `EPERM ... unlink`).
2. Выполняет `npm install` каждый раз. Если ничего не изменилось, это быстро, а после обновления проекта подхватываются новые зависимости (без этого сборка падает с «Production dependency … not found»).
3. Удаляет старую папку `dist`.
4. Запускает `npm run build` и открывает папку с результатом.

Результат:

- `dist\ManyGameLib-Setup-<версия>.exe`: установщик.
- `dist\win-unpacked\ManyGameLib.exe`: портативная папка. Её можно переносить или упаковывать в архив; для запуска Node.js не нужен.

Скрипт сборки это `electron-builder --publish never`: публикацией занимается workflow, а не сам `npm run build`.

### Раздел `build` в `package.json`

| Параметр | Значение | Зачем |
|----------|----------|-------|
| `appId` / `productName` | `com.manygamelib.app` / `ManyGameLib` | Идентификатор и имя exe |
| `files` | `main.js`, `preload.js`, `updater.js`, `zip.js`, `sgdb.js`, `ui/**/*`, `build/**/*` (без `build/afterPack.js`) | В пакет попадает только то, что нужно приложению |
| `afterPack` | `build/afterPack.js` | Вписывает иконку и сведения о версии в exe (см. ниже) |
| `publish` | GitHub, `manypon/ManyGameLib` | Заставляет electron-builder писать `latest.yml` и `app-update.yml` для обновлятора; сама сборка ничего не публикует |
| `electronDist` | `node_modules/electron/dist` | Использовать Electron, уже установленный `npm install`, а не скачивать его заново во время сборки |
| `directories.output` | `dist` | Папка результата сборки |
| `win.target` | `dir`, `nsis` | Распакованная папка (портативная версия) и установщик NSIS |
| `nsis` | см. ниже | Поведение установщика |
| `win.icon` | `build/icon.ico` | Значок приложения |
| `win.signAndEditExecutable` | `false` | Пропускает собственную правку exe в electron-builder: она требует winCodeSign и права на символьные ссылки и падает с `EPERM` на обычной учётной записи Windows. Вместо неё работает `afterPack` |

### Иконка exe: `afterPack`

При `signAndEditExecutable: false` exe осталось бы со стандартной иконкой Electron (атом), а ярлыки Windows, поиск и панель задач берут иконку именно из exe. `build/afterPack.js` запускается после сборки приложения и через пакет `rcedit` вписывает в `ManyGameLib.exe` иконку `build/icon.ico`, название продукта, версию и авторские права. Ничего скачивать не нужно. Если ярлык после обновления всё ещё показывает старую иконку, это кэш иконок Windows; он обновится после перезагрузки.

### Установщик

Настройки `nsis`: `oneClick: false` (папку можно выбрать), `perMachine: false` (установка для текущего пользователя, права администратора не нужны), ярлыки на рабочем столе и в меню «Пуск», `artifactName` `ManyGameLib-Setup-${version}.exe`. `deleteAppDataOnUninstall` равен `false`, а библиотека и так лежит в `%USERPROFILE%\manypon\manygamelib`, вне папки установки, поэтому обновление и удаление не трогают игры, картинки и настройки.

Установщик не подписан кодом, поэтому Windows SmartScreen может предупредить при первом запуске («Подробнее», затем «Выполнить в любом случае»). Инструменты NSIS electron-builder скачивает при первой сборке, поэтому первой локальной сборке нужен доступ к GitHub.

### Если Electron не скачивается

`npm install` скачивает Electron с GitHub. Если не вышло (например, ошибка 504), можно собрать приложение вручную из уже имеющегося Electron: скопируйте его папку `dist` как `ManyGameLib`, переименуйте `electron.exe` в `ManyGameLib.exe`, а `main.js`, `preload.js`, `updater.js`, `zip.js`, `sgdb.js`, `package.json`, `ui` и `build` положите в `resources\app`.

## Версии и коммиты

- Версия хранится в `package.json` и следует семантическому версионированию: патч (1.1.x) для исправлений, минорная (1.x.0) для новых функций. Интерфейс читает её у главного процесса (`get_version`), поэтому менять её нужно только в одном месте.
- Сообщения коммитов следуют Conventional Commits: короткий заголовок строчными буквами без тела, например `fix: block repeated game launch` или `perf: debounce library search`.
- Правила для участников (сообщения об ошибках, ветки, pull request'ы) описаны в `CONTRIBUTING.md`.

## Автоматическая сборка и релиз (GitHub Actions)

В `.github/workflows/` лежат два workflow.

### `build.yml`: сборка и публикация

Запускается при пуше тега, начинающегося с `v` (например, `v1.1.1`), или вручную со вкладки Actions (`workflow_dispatch`). На `windows-latest` он:

1. Забирает репозиторий и настраивает Node.js 20 с кешем npm.
2. Выполняет `npm install` с `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`. Зеркало обходит неудачные скачивания Electron с GitHub (ошибки 504, упомянутые выше).
3. Выполняет `node node_modules/electron/install.js`, чтобы гарантированно получить бинарник Electron, ведь `electronDist` в `package.json` указывает на него.
4. Выполняет `npm run build`.
5. Загружает `dist/win-unpacked/` как артефакт workflow с именем `ManyGameLib-Windows`, а установщик как `ManyGameLib-Installer`.
6. Упаковывает содержимое `dist/win-unpacked/` в `ManyGameLib-Build.zip` и прикрепляет его к релизу вместе с `ManyGameLib-Setup-<версия>.exe`, его `.blockmap` и `latest.yml` (последние два нужны обновлятору) для тега (`softprops/action-gh-release`, с правом `contents: write` и встроенным `GITHUB_TOKEN`).

Что важно знать:

- В архиве лежит *содержимое* `win-unpacked` сразу, без папки верхнего уровня, поэтому пользователям стоит распаковывать его в отдельную папку.
- Ручной запуск не привязан к тегу: тогда имя релиза берётся из имени ветки (`github.ref_name`). Для настоящих релизов используйте теги.

### `state.yml`: устаревшие issue

Запускается каждый день в 00:00 UTC (и вручную). Issue без активности 30 дней получает комментарий с вопросом, актуален ли он (текст на русском); если никто не ответил, через 7 дней он закрывается. Issue с метками `bug` или `enhancement` не затрагиваются никогда.

## Выпуск релиза

1. Убедитесь, что в `package.json` стоит новая версия (она меняется один раз, в первом коммите релиза).
2. По возможности проверьте сборку локально через `build.bat`.
3. Создайте и отправьте тег: `git tag v1.1.1`, затем `git push origin v1.1.1`.
4. Дождитесь workflow `Build Electron App`: он создаст релиз с `ManyGameLib-Setup-<версия>.exe` и `ManyGameLib-Build.zip`.
5. Отредактируйте описание релиза: что нового и как установить, на английском и русском.

## Структура проекта

```
manygamelib/
├─ main.js         главный процесс
├─ preload.js      мост между интерфейсом и main.js
├─ ui/             index.html, style.css, app.js
│  └─ assets/      wallpaper-default.webp (фон приложения по умолчанию)
├─ build/          icon.png, icon.ico
├─ docs/           эта документация
├─ .github/        workflow'ы GitHub Actions
├─ CONTRIBUTING.md как помочь проекту
├─ start.bat       запуск из исходников
├─ build.bat       сборка приложения
└─ package.json    скрипты, зависимости, настройки electron-builder
```
