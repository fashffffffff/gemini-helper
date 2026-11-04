import { createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { mkdir, unlink } from 'node:fs/promises';
import { PROJECT, STATE } from './config.js';
import type { FlowAction } from './browser.js';

export const BROWSER_SOCKET = join(STATE, 'flow.sock');
export type BrowserRequest = { account: string; action: 'open' | 'snapshot' | 'screenshot' | 'close' } | ({account: string} & FlowAction);

function request(request: BrowserRequest): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(BROWSER_SOCKET);
    let input = '';
    socket.setEncoding('utf8');
    socket.setTimeout(60_000, () => socket.destroy(new Error('Browser timed out. Reopen Flow and retry.')));
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.on('data', chunk => {
      input += chunk;
      if (input.length > 30_000_000) { socket.destroy(new Error('Browser response too large.')); return; }
      if (!input.includes('\n')) return;
      socket.end();
      try { const result = JSON.parse(input.split('\n')[0]); result.error ? reject(new Error(result.error)) : resolve(result.result); } catch (error) { reject(error); }
    });
    socket.on('error', reject);
    socket.on('end', () => { if (!input.includes('\n')) reject(new Error('Browser daemon disconnected.')); });
  });
}

export async function browserCall(input: BrowserRequest) {
  if (process.platform === 'win32') throw new Error('Legacy Flow browser integration is unavailable on Windows. Use google_image for images.');
  try { return await request(input); } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['ENOENT', 'ECONNREFUSED'].includes(code ?? '')) throw error;
    await mkdir(STATE, { recursive: true, mode: 0o700 });
    if (code === 'ECONNREFUSED') await unlink(BROWSER_SOCKET).catch(() => {});
    const child = spawn(process.execPath, [join(PROJECT, 'dist/browser-daemon.js')], { detached: true, stdio: 'ignore', env: { ...process.env, GOOGLE_PRO_BROWSER_DAEMON: '1' } });
    child.unref();
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setTimeout(resolve, 150));
      try { return await request(input); } catch (retryError) {
        if (!['ENOENT', 'ECONNREFUSED'].includes((retryError as NodeJS.ErrnoException).code ?? '')) throw retryError;
      }
    }
    throw new Error('BROWSER_START: Unable to start local Flow browser. Run google-pro doctor.');
  }
}
