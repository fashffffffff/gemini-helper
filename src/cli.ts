#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PROJECT, GEMINI_BIN, DEFAULT_MODEL, accountStatus, prepareAccount, subscriptionEnv } from './config.js';
import { launchFlowLogin } from './browser-launch.js';
import { browserCall } from './browser-client.js';
import { connectionConfig, installClient, writeConnectionFiles } from './install.js';
import { runGemini } from './gemini.js';

const [command = 'help', arg = '1', ...rest] = process.argv.slice(2);
const out = (data: unknown) => console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));

async function login(account: string) {
  const paths = await prepareAccount(account);
  out(`Аккаунт ${account}: выбери Sign in with Google. После входа напиши «Привет», затем /quit. API key и Vertex не нужны.`);
  const child = spawn(process.execPath, [GEMINI_BIN, '--model', DEFAULT_MODEL, '--extensions', '', '--policy', join(PROJECT, 'config/web-only.toml')], { cwd: paths.work, env: subscriptionEnv(account), stdio: 'inherit', shell: false });
  const code = await new Promise<number>((resolve, reject) => { child.on('error', reject); child.on('close', c => resolve(c ?? 1)); });
  process.exitCode = code;
}

async function doctor() {
  let cliInstalled = true, browserInstalled = true;
  try { await access(GEMINI_BIN); } catch { cliInstalled = false; }
  try { await access(chromium.executablePath()); } catch { browserInstalled = false; }
  return {
    node: process.version, cliInstalled, browserInstalled, defaultModel: DEFAULT_MODEL,
    mode: 'Google login only; no paid API, no billing setup, no top-ups, no automatic account fallback',
    accounts: await Promise.all(['1','2'].map(x => accountStatus(x))),
    liveGoogleTest: 'Not run by doctor. Use google-pro check 1 (or 2) after login.',
  };
}

try {
  switch (command) {
    case 'setup': {
      for (const account of ['1', '2']) await prepareAccount(account);
      out(`Конфигурации: ${await writeConnectionFiles()}`);
      out(await doctor());
      break;
    }
    case 'login': await login(arg); break;
    case 'flow-login': {
      const paths = await prepareAccount(arg);
      await browserCall({ account: arg, action: 'close' });
      await launchFlowLogin(paths.browser);
      out('Войди в Google в открытом окне, открой проект Flow и закрой это отдельное окно. Затем MCP сможет открыть тот же профиль.');
      break;
    }
    case 'flow': {
      const result = await browserCall({ account: arg, action: 'open' });
      out({ url: result.url, message: `Открыт отдельный браузер аккаунта ${arg}. Войди в нужный Google-аккаунт вручную. Окно можно оставить открытым.` });
      break;
    }
    case 'flow-close': out(await browserCall({ account: arg, action: 'close' })); break;
    case 'doctor': out(await doctor()); break;
    case 'check': out(await runGemini({ account: arg, task: 'ask', prompt: 'Ответь одним словом: работает.' })); break;
    case 'ask': out(await runGemini({ account: arg, task: 'ask', prompt: rest.join(' ') })); break;
    case 'install': out(await installClient(arg)); break;
    case 'connections': await writeConnectionFiles(); out({ mcpServers: { 'google-pro': connectionConfig() } }); break;
    case 'unlock': {
      // Explicit recovery only, never remove another live process's lock automatically.
      const paths = await prepareAccount(arg);
      await rm(join(paths.base, 'cli.lock'), { recursive: true, force: true });
      out('Блокировка снята. Используй только после завершения всех запросов этого аккаунта.');
      break;
    }
    default: out(`Google Pro Assistant — без платного API\n\nsetup                 Подготовить профили и конфигурации\nlogin 1|2             Войти через официальный Gemini CLI\nflow-login 1|2        Открыть отдельный браузер Flow\ncheck 1|2             Проверить настоящий запрос Gemini\nask 1|2 "вопрос"       Задать вопрос\ndoctor                Проверить установку (без запроса Google)\ninstall codex         Подключить к Codex\ninstall claude-desktop Подключить к Claude Desktop\ninstall claude-code   Подключить к Claude Code (нужен его CLI)\nconnections           Показать конфигурацию для любого MCP-клиента\nflow-close 1|2        Закрыть браузер аккаунта\nunlock 1|2            Снять зависшую блокировку после аварийного завершения\n\nЗапуск: node ${join(PROJECT, 'dist/cli.js')} <команда>`);
  }
} catch (error) { console.error(error instanceof Error ? error.message : 'Operation failed.'); process.exitCode = 1; }
