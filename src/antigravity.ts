import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PROJECT, subscriptionEnv } from './config.js';
import { runProcess } from './process.js';

export const AGY = join(PROJECT, '.agy-bin', process.platform === 'win32' ? 'agy.exe' : 'agy');

interface FileInput { path: string; content: string }

export async function runAntigravity(task: string, work: string, signal?: AbortSignal) {
  const settingsPath = join(homedir(), '.gemini/antigravity-cli/settings.json');
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Check the Antigravity CLI settings file.');
  }
  if (settings.useG1Credits || settings.allowNonWorkspaceAccess || settings.toolPermission === 'always-proceed' || (settings.permissions as {allow?: unknown[]} | undefined)?.allow?.length) {
    throw new Error('In Antigravity CLI /config, turn off AI credit fallback and non-workspace access. Use the default review policy without global tool allow rules.');
  }
  const env = subscriptionEnv('1');
  delete env.GEMINI_CLI_HOME;
  delete env.GEMINI_CLI_NO_RELAUNCH;
  const result = await runProcess(AGY, ['-p', task, '--output-format', 'json', '--print-timeout', '150s', '--disable-slash-commands', '--mode', 'accept-edits', '--sandbox', '--settings', JSON.stringify({ useG1Credits: false, permissions: { deny: ['command(*)', 'mcp(*)'] } }), '--model', 'gemini-3.8-flash-medium'], {
    cwd: work, env, signal, timeoutMs: 165000,
  });
  let data: { status?: string; response?: string; error?: string; conversation_id?: string };
  try {
    data = JSON.parse(result.stdout);
  } catch {
    data = {};
  }
  if (result.code !== 0 || data.status !== 'SUCCESS') {
    const diagnostic = (data.error ?? '') + result.stderr;
    if (/verified your age|18 years old or older/i.test(diagnostic)) {
      throw new Error('Antigravity requires Google account age verification (18+). Verify the age on the signed-in account, then reconnect.');
    }
    if (/valid license|#3501/i.test(diagnostic)) throw new Error('Antigravity rejected access with a license error (#3501).');
    if (/authenticat|sign.in|log.in|credential/i.test(diagnostic)) throw new Error(`Sign in with Google AI Pro using ${AGY} and try again.`);
    if (/quota|429|resource.exhausted/i.test(diagnostic)) throw new Error('Antigravity quota exhausted.');
    throw new Error('Antigravity did not complete the task. Check the model and account in the interactive CLI.');
  }
  return data;
}

export async function delegate(prompt: string, files: FileInput[], signal?: AbortSignal) {
  const work = await mkdtemp(join(tmpdir(), 'google-pro-delegate-'));
  const original = new Map<string, string>();
  try {
    for (const file of files) {
      const parts = file.path.split('/');
      if (parts.some(part => !/^[a-zA-Z0-9_][a-zA-Z0-9_. -]*$/.test(part))) {
        throw new Error('Use relative file paths without hidden entries or parent traversal.');
      }
      if (original.has(file.path)) throw new Error('Duplicate input path.');
      original.set(file.path, file.content);
      const path = join(work, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content, { flag: 'wx' });
    }
    const task = 'Work only in the provided scratch workspace. Use file tools for requested edits. Do not use terminal commands or external integrations. Summarize your result.\n\n' + prompt;
    const data = await runAntigravity(task, work, signal);
    const changes: { path: string; content: string | null }[] = [];
    const pending = new Set(original.keys());
    let bytes = 0;
    for (const entry of await readdir(work, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      const relative = path.slice(work.length + 1);
      if (relative.split('/').some(part => part.startsWith('.'))) continue;
      pending.delete(relative);
      bytes += (await stat(path)).size;
      if (bytes > 350000) throw new Error('Antigravity output exceeds the workspace size limit.');
      const content = await readFile(path, 'utf8');
      if (content.includes('\0')) throw new Error('Only text files are supported.');
      if (content !== original.get(relative)) changes.push({ path: relative, content });
    }
    for (const path of pending) changes.push({ path, content: null });
    return { response: data.response ?? '', changes };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
