# Gemini Helper

Локальный MCP для Codex и Claude. Помощник может поручить Gemini поиск источников, подготовку текста, небольшие правки файлов и генерацию изображений. Запросы идут через официальный Antigravity CLI под твоим аккаунтом Google.

## Скачать и установить на macOS

Нужны Node.js 22 или новее и установленный Codex, Claude Code или Claude Desktop.

1. [Скачай ZIP проекта](https://github.com/fashffffffff/gemini-helper/archive/refs/heads/main.zip) и распакуй его в постоянную папку.
2. Открой `setup.command` двойным кликом. Если macOS не запускает скрипт из Finder, открой терминал в распакованной папке и выполни `zsh setup.command`.
3. Войди в свой аккаунт Google AI Pro в окне авторизации Antigravity.
4. Перезапусти Codex или Claude, чтобы загрузился MCP `google-pro`.

Скрипт установит зависимости, скачает Antigravity CLI с сайта Google и подключит MCP к найденным клиентам. Codex и Claude Code также получат скилл `gemini-helper`. Claude Desktop получает правила делегирования из самого MCP.

Вместо ZIP можно клонировать репозиторий:

```sh
git clone https://github.com/fashffffffff/gemini-helper.git
cd gemini-helper
zsh setup.command
```

## Примеры

- «Поручи Gemini собрать три официальных источника по теме и проверь ссылки».
- «Попроси Gemini переписать этот раздел README и покажи правки».
- «Сгенерируй через Gemini иллюстрацию бумажного кораблика».

`google_delegate` передаёт выбранные текстовые файлы в отдельную временную папку и возвращает правки. Основной агент проверяет их перед применением.

`google_image` запускает встроенный генератор Antigravity и возвращает путь к изображению и превью. Файлы сохраняются в `~/.local/share/google-pro-assistant/images/`. Генерация зависит от доступности модели и лимитов Google. При ошибке 429 можно повторить запрос позже. Инструмент работает через вход Google, без отдельного API-ключа и платного резерва.

Если Antigravity просит войти снова, запусти из папки проекта:

```sh
./.agy-bin/agy acp --login
```

Проблемы с возрастом, регионом или доступом к подписке разбираются в [справке Antigravity](https://antigravity.google/docs/faq).

## Разработка

```sh
npm ci
npm run build
npx playwright install chromium
npm test
```

Поддержка Flow сохранена отдельно в `google_flow`. Для неё нужен Chromium и доступ к Flow на аккаунте. Обычные задачи и генерация через `google_image` не требуют установки Chromium.
