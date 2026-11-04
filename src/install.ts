import { mkdir, readFile, writeFile, copyFile, rename, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { PROJECT } from './config.js';
import { runProcess } from './process.js';

export function connectionConfig() { return { command: process.execPath, args: [join(PROJECT, 'dist/server.js')] }; }

export function setCodexTimeout(toml: string) {
  const header = /^\[mcp_servers\.google-pro\][^\S\n]*\n/m;
  const found = header.exec(toml);
  if (!found) throw new Error('Codex MCP section not found after registration; timeout was not changed.');
  const start = found.index + found[0].length;
  const next = toml.slice(start).search(/^\[/m);
  const end = next < 0 ? toml.length : start + next;
  const section = toml.slice(start, end).replace(/^tool_timeout_sec\s*=.*\n?/gm, '');
  return toml.slice(0, start) + 'tool_timeout_sec = 240\n' + section + toml.slice(end);
}

export async function installJsonConfig(file: string) {
  let data: Record<string, any> = {}, backup: string | undefined;
  try {
    const raw = await readFile(file, 'utf8');
    try { data = JSON.parse(raw); } catch { throw new Error('Existing JSON configuration is invalid; it was not changed.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data) || (data.mcpServers && (typeof data.mcpServers !== 'object' || Array.isArray(data.mcpServers)))) throw new Error('Existing JSON configuration has an unsupported shape; it was not changed.');
    backup = `${file}.backup-${Date.now()}-${randomUUID().slice(0, 6)}`;
    await copyFile(file, backup); await chmod(backup, 0o600);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  data.mcpServers = { ...data.mcpServers, 'google-pro': connectionConfig() };
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${randomUUID()}`;
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, file);
  return { file, backup };
}

export function claudeDesktopConfig() {
  const folder = process.platform === 'darwin' ? join(homedir(), 'Library/Application Support/Claude') : join(process.env.APPDATA ?? join(homedir(), '.config'), 'Claude');
  return join(folder, 'claude_desktop_config.json');
}

export function runClientCommand(command: string, args: string[]) {
  if (process.platform !== 'win32') return runProcess(command, args, { timeoutMs: 15000 });
  const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
  const code = '& ' + [command, ...args].map(quote).join(' ') + '; if (-not $?) { exit 1 }; exit $LASTEXITCODE';
  return runProcess('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { timeoutMs: 15000 });
}

export async function installClient(client: string) {
  const config = connectionConfig();
  if (client === 'claude-desktop') {
    return installJsonConfig(claudeDesktopConfig());
  }
  if (client === 'claude-code') {
    return installJsonConfig(join(homedir(), '.claude.json'));
  }
  if (client === 'codex') {
    const file = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml');
    let backup: string | undefined;
    try { backup = `${file}.backup-google-pro-${Date.now()}`; await copyFile(file, backup); await chmod(backup, 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; backup = undefined; }
    const result = await runClientCommand('codex', ['mcp', 'add', 'google-pro', '--', config.command, ...config.args]);
    if (result.code !== 0) throw new Error('Codex CLI could not register the MCP. See connections/codex.toml.');
    await writeFile(file, setCodexTimeout(await readFile(file, 'utf8')), { mode: 0o600 });
    return { installed: client, backup };
  }
  throw new Error('Choose codex, claude-desktop or claude-code.');
}

export async function writeConnectionFiles() {
  const folder = join(PROJECT, 'connections'); await mkdir(folder, { recursive: true });
  const config = connectionConfig();
  await writeFile(join(folder, 'mcp.json'), JSON.stringify({ mcpServers: { 'google-pro': config } }, null, 2) + '\n');
  await writeFile(join(folder, 'codex.toml'), `[mcp_servers.google-pro]\ncommand = ${JSON.stringify(config.command)}\nargs = ${JSON.stringify(config.args)}\ntool_timeout_sec = 240\n`);
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(join(folder, 'claude-code.txt'), `claude mcp add --transport stdio --scope user google-pro -- ${[config.command, ...config.args].map(quote).join(' ')}\n`);
  return folder;
}
