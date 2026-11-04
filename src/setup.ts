import { spawnSync } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { AGY } from './antigravity.js';
import { PROJECT } from './config.js';
import { claudeDesktopConfig, installClient, runClientCommand } from './install.js';

const windows = process.platform === 'win32';
const args = process.argv.slice(2);
const clientOption = args.indexOf('--client');
const selected = clientOption < 0 ? undefined : args[clientOption + 1];
const clients = ['codex', 'claude-code', 'claude-desktop'];
if (clientOption >= 0 && !clients.includes(selected ?? '')) throw new Error('Use --client codex, claude-code or claude-desktop.');

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

async function exists(path: string) {
  try { await access(path); return true; } catch { return false; }
}

async function installAntigravity() {
  if (await exists(AGY)) return;
  const work = await mkdtemp(join(tmpdir(), 'gemini-helper-install-'));
  try {
    const extension = windows ? 'ps1' : 'sh';
    const url = `https://antigravity.google/cli/install.${extension}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Could not download the official Antigravity installer: HTTP ${response.status}`);
    const script = join(work, `install.${extension}`);
    await writeFile(script, await response.text());
    const binDir = join(PROJECT, '.agy-bin');
    await mkdir(binDir, { recursive: true });
    if (windows) run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '--dir', binDir]);
    else run('bash', [script, '--dir', binDir]);
    if (!await exists(AGY)) throw new Error('Antigravity installer did not create the expected executable.');
  } finally { await rm(work, { recursive: true, force: true }); }
}

async function hasCli(command: string) {
  try { return (await runClientCommand(command, ['--version'])).code === 0; } catch { return false; }
}

async function installSkill(base: string) {
  const dir = join(base, 'skills', 'gemini-helper');
  await mkdir(dir, { recursive: true });
  await copyFile(join(PROJECT, 'skills/gemini-helper/SKILL.md'), join(dir, 'SKILL.md'));
}

if (process.platform === 'darwin') {
  process.env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS', process.env.PATH].join(delimiter);
}

const targets = selected ? [selected] : [];
if (!selected) {
  if (await hasCli('codex')) targets.push('codex');
  if (await hasCli('claude')) targets.push('claude-code');
  if (await exists(claudeDesktopConfig()) ||
      (process.platform === 'darwin' && await exists('/Applications/Claude.app')) ||
      (windows && process.env.LOCALAPPDATA && await exists(join(process.env.LOCALAPPDATA, 'AnthropicClaude')))) {
    targets.push('claude-desktop');
  }
}
if (!targets.length) throw new Error('No client detected. For Claude Desktop run npm run setup -- --client claude-desktop. For Codex or Claude Code add its CLI to PATH.');

await installAntigravity();
run(AGY, ['--version']);
for (const client of targets) {
  await installClient(client);
  if (client === 'codex') await installSkill(process.env.CODEX_HOME ?? join(homedir(), '.codex'));
  if (client === 'claude-code') await installSkill(join(homedir(), '.claude'));
  console.log(`Connected google-pro to ${client}.`);
}
if (!args.includes('--no-login')) {
  console.log('Sign in to Antigravity with Google, then restart Codex or Claude.');
  run(AGY, ['acp', '--login']);
}
