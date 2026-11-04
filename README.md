# Gemini Helper

Локальный MCP для Codex и Claude. Помощник может поручить Gemini поиск источников, подготовку текста, небольшие правки файлов и генерацию изображений. Запросы идут через официальный Antigravity CLI под твоим аккаунтом Google.

## Установка из терминала

На Windows открой PowerShell. На Linux или macOS открой обычный терминал.
Нужны Git, Node.js 22+ и установленный Codex, Claude Code или Claude Desktop.

```sh
git clone https://github.com/fashffffffff/gemini-helper.git
cd gemini-helper
npm ci
npm run setup
```

Установщик скачает официальный Antigravity CLI для твоей ОС, подключит MCP
`google-pro` к найденным клиентам и запустит вход в Google. Выбери свой
аккаунт Google AI Pro, затем перезапусти Codex или Claude.

Чтобы подключить один клиент, запусти `npm run setup -- --client codex`,
`npm run setup -- --client claude-code` или `npm run setup -- --client claude-desktop`.
Если Codex или Claude Code не определился, проверь, что его CLI доступен в PATH.
Установка Codex и Claude Code также добавляет скилл `gemini-helper`.

Обновление после установки:

```sh
git pull --ff-only
npm ci
npm run setup -- --no-login
```

## Примеры

- «Поручи Gemini собрать три официальных источника по теме и проверь ссылки».
- «Попроси Gemini переписать этот раздел README и покажи правки».
- «Сгенерируй через Gemini иллюстрацию бумажного кораблика».

`google_delegate` передаёт выбранные текстовые файлы в отдельную временную папку и возвращает правки. Основной агент проверяет их перед применением.

`google_image` запускает встроенный генератор Antigravity и возвращает путь к изображению и превью. Файлы сохраняются в `~/.local/share/google-pro-assistant/images/`. Генерация зависит от доступности модели и лимитов Google. При ошибке 429 можно повторить запрос позже. Инструмент работает через вход Google, без отдельного API-ключа и платного резерва.

Если Antigravity просит войти снова, запусти из папки проекта:

```sh
npm run setup
```

Проблемы с возрастом, регионом или доступом к подписке разбираются в [справке Antigravity](https://antigravity.google/docs/faq).

## Разработка

```sh
npm ci
npm run build
npx playwright install chromium
npm test
```

Устаревший браузерный режим Flow доступен отдельно на Linux и macOS. Для него нужен Chromium и доступ к Flow на аккаунте. Обычные задачи и генерация через `google_image` не требуют установки Chromium.
