import { spawn } from 'node:child_process';
import { access, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

async function browserExecutable() {
  let executablePath = chromium.executablePath();
  for (const candidate of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']) {
    try { await access(candidate); executablePath = candidate; break; } catch {}
  }
  return executablePath;
}

export async function launchFlowLogin(profile: string) {
  const executablePath = await browserExecutable();
  const child = spawn(executablePath, [`--user-data-dir=${profile}`, '--no-first-run', 'https://flow.google.com/'], { detached: true, stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
}

export async function launchFlowBrowser(profile: string) {
  const executablePath = await browserExecutable();
  const portFile = join(profile, 'DevToolsActivePort');
  await unlink(portFile).catch(() => {});
  // Launch the regular browser with its normal security defaults, then use its
  // documented local CDP interface. No Playwright automation launch flags,
  // stealth patches, cookie copying, mock keychains or disabled browser sandbox.
  const child = spawn(executablePath, [
    `--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: 'ignore', shell: false });
  let startError: Error | undefined;
  child.on('error', error => { startError = error; });
  for (let i = 0; i < 100; i++) {
    if (startError) throw startError;
    if (child.exitCode !== null) throw new Error('BROWSER_START: Browser exited. Close any other window using this dedicated Flow profile.');
    let port: number | undefined;
    try { port = Number((await readFile(portFile, 'utf8')).split('\n')[0]); } catch {}
    if (port && Number.isInteger(port) && port > 0 && port < 65536) {
      try {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2000 });
        const context = browser.contexts()[0];
        if (!context) throw new Error('No default browser context.');
        const close = async () => { await browser.close().catch(() => {}); if (child.exitCode === null) child.kill('SIGTERM'); };
        return { context, close, executablePath };
      } catch (error) { if (i === 99) throw error; }
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  child.kill('SIGTERM');
  throw new Error('BROWSER_START: Local browser debugging interface did not become ready.');
}
