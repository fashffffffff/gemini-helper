import { createServer } from 'node:net';
import { chmod } from 'node:fs/promises';
import type { BrowserContext } from 'playwright';
import { z } from 'zod';
import { prepareAccount } from './config.js';
import { FlowPage, FLOW_URL } from './browser.js';
import { BROWSER_SOCKET } from './browser-client.js';
import { launchFlowBrowser } from './browser-launch.js';

const sessions = new Map<string, { context: BrowserContext; flow: FlowPage; close: () => Promise<void> }>();
const requestSchema = z.object({
  account: z.enum(['1', '2']),
  action: z.enum(['open', 'snapshot', 'screenshot', 'close', 'click', 'fill', 'press', 'upload', 'download', 'scroll', 'wait']),
  ref: z.string().max(100).optional(), text: z.string().max(30000).optional(),
  files: z.array(z.string().max(4096)).max(8).optional(), direction: z.enum(['up', 'down']).optional(), seconds: z.number().min(0.1).max(15).optional(),
});
let queue = Promise.resolve();
let lastUsed = Date.now();

async function session(account: string) {
  const old = sessions.get(account);
  if (old && !old.flow.page.isClosed()) return old;
  if (old) {
    const paths = await prepareAccount(account);
    old.flow = new FlowPage(await old.context.newPage(), paths.downloads);
    return old;
  }
  const paths = await prepareAccount(account);
  const { context, close } = await launchFlowBrowser(paths.browser);
  const page = context.pages()[0] ?? await context.newPage();
  const current = { context, flow: new FlowPage(page, paths.downloads), close };
  sessions.set(account, current);
  context.on('close', () => { if (sessions.get(account) === current) sessions.delete(account); });
  return current;
}

async function dispatch(raw: unknown) {
  const input = requestSchema.parse(raw);
  if (input.action === 'close') {
    await sessions.get(input.account)?.close(); sessions.delete(input.account);
    return { closed: true, account: input.account };
  }
  const { flow } = await session(input.account);
  if (input.action === 'open') {
    await flow.page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await flow.page.bringToFront();
    return flow.snapshot();
  }
  if (input.action === 'snapshot') return flow.snapshot();
  if (input.action === 'screenshot') return { image: (await flow.screenshot()).toString('base64'), mimeType: 'image/png' };
  return flow.action({ ...input, action: input.action });
}

const server = createServer(socket => {
  socket.setEncoding('utf8'); socket.setTimeout(70_000, () => socket.destroy());
  let buffer = '', received = false;
  socket.on('error', () => {});
  socket.on('data', chunk => {
    if (received) return;
    buffer += chunk;
    if (buffer.length > 1_000_000) return socket.destroy();
    if (!buffer.includes('\n')) return;
    received = true;
    queue = queue.then(async () => {
      lastUsed = Date.now();
      try { const result = await dispatch(JSON.parse(buffer.split('\n')[0])); socket.end(JSON.stringify({ result }) + '\n'); }
      catch (error) { socket.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Flow browser failed.' }) + '\n'); }
      lastUsed = Date.now();
    }).catch(() => {});
  });
});
server.on('error', () => process.exit(1));
server.listen(BROWSER_SOCKET, async () => { await chmod(BROWSER_SOCKET, 0o600); });
const idle = setInterval(async () => {
  if (Date.now() - lastUsed < 30 * 60_000) return;
  clearInterval(idle); for (const {close} of sessions.values()) await close();
  server.close(() => process.exit(0));
}, 60_000);
process.on('SIGTERM', async () => {
  for (const {close} of sessions.values()) await close();
  server.close(() => process.exit(0));
});
