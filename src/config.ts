import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const STATE = join(homedir(), '.local/share/google-pro-assistant');
export const GEMINI_BIN = join(PROJECT, 'node_modules/@google/gemini-cli/bundle/gemini.js');
export const DEFAULT_MODEL = 'gemini-3.8-flash';
export type Account = '1' | '2';
export function accountPaths(account: string, root = STATE) {
  if (account !== '1' && account !== '2') throw new Error('Invalid account. Choose 1 or 2.');
  const base = join(root, 'accounts', account);
  return { base, cliHome: join(base, 'cli'), work: join(base, 'workspace'), browser: join(base, 'browser'), downloads: join(base, 'downloads') };
}

// Deliberate allowlist: no API keys, cloud billing credentials, auth overrides, proxy
// endpoints or NODE_OPTIONS from the parent agent can reach the official CLI.
export function subscriptionEnv(account: string, root = STATE, parent = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM', 'DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'COMSPEC', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) {
    const actual = process.platform === 'win32' ? Object.keys(parent).find(name => name.toUpperCase() === key.toUpperCase()) : key;
    if (actual && parent[actual] !== undefined) env[actual] = parent[actual];
  }
  env.GEMINI_CLI_HOME = accountPaths(account, root).cliHome;
  env.GEMINI_CLI_NO_RELAUNCH = 'true';
  env.NO_COLOR = '1';
  return env;
}

export async function prepareAccount(account: string, root = STATE) {
  const paths = accountPaths(account, root);
  for (const p of [root, join(root, 'accounts'), paths.base, paths.cliHome, join(paths.cliHome, '.gemini'), paths.work, paths.browser, paths.downloads]) {
    await mkdir(p, { recursive: true, mode: 0o700 });
    await chmod(p, 0o700);
  }
  const settings = {
    security: { auth: { selectedType: 'oauth-personal' } },
    tools: { core: ['google_web_search', 'web_fetch'] },
    mcpServers: {},
    telemetry: { enabled: false },
    context: { fileName: 'CONNECTOR_CONTEXT.md', loadMemoryFromIncludeDirectories: false },
    general: { enableAutoUpdate: false, enablePromptCompletion: false },
    hooks: { enabled: [] },
    skills: { enabled: false },
  };
  await writeFile(join(paths.cliHome, '.gemini/settings.json'), JSON.stringify(settings, null, 2), { mode: 0o600 });
  return paths;
}

export async function exists(path: string) {
  try { await readFile(path); return true; } catch { return false; }
}

export async function accountStatus(account: string, root = STATE) {
  const p = accountPaths(account, root);
  return {
    account, googleLoginCached: await exists(join(p.cliHome, '.gemini/oauth_creds.json')),
    browserProfileCreated: await exists(join(p.browser, 'Local State')),
    downloads: p.downloads,
    loginCommand: `node ${JSON.stringify(join(PROJECT, 'dist/cli.js'))} login ${account}`,
    note: 'Cached credentials do not prove a valid session, a Pro subscription, model access or remaining quota.',
  };
}
