import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FlowPage, allowedFlowUrl } from '../src/browser.js';

test('Flow URL restrictions reject lookalike and payment domains', () => {
  assert.equal(allowedFlowUrl('https://labs.google/fx/tools/flow'), true);
  assert.equal(allowedFlowUrl('https://labs.google.com/fx/tools/flow'), true);
  assert.equal(allowedFlowUrl('https://labs.google.evil.example/flow'), false);
  assert.equal(allowedFlowUrl('https://pay.google.com/'), false);
});

test('browser uses current DOM refs, edits prompts, blocks purchases and downloads original media', async () => {
  const root = await mkdtemp(join(tmpdir(), 'google-flow-'));
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ acceptDownloads: true });
    await page.route('https://labs.google/**', route => route.fulfill({ contentType: 'text/html', body: `
      <h1>Flow fixture</h1><textarea aria-label="Describe image"></textarea>
      <button onclick="document.querySelector('h1').textContent='Generated'">Generate</button>
      <button onclick="document.querySelector('h1').textContent='PAID'">Buy more credits</button>
      <a download="original.svg" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E">Download</a>
    ` }));
    await page.goto('https://labs.google/fx/tools/flow');
    const flow = new FlowPage(page, root);
    const first = await flow.snapshot();
    const prompt = first.controls.find(x => x.name === 'Describe image')!;
    await flow.action({ action: 'fill', ref: prompt.ref, text: 'кот в космосе' });
    assert.equal(await page.locator('textarea').inputValue(), 'кот в космосе');
    await assert.rejects(flow.action({ action: 'click', ref: prompt.ref }), /STALE/);
    let snap = await flow.snapshot();
    await assert.rejects(flow.action({ action: 'click', ref: snap.controls.find(x => x.name === 'Buy more credits')!.ref }), /PAYMENT_BLOCKED/);
    assert.equal(await page.locator('h1').textContent(), 'Flow fixture');
    snap = await flow.snapshot();
    await flow.action({ action: 'click', ref: snap.controls.find(x => x.name === 'Generate')!.ref });
    assert.equal(await page.locator('h1').textContent(), 'Generated');
    snap = await flow.snapshot();
    const download = await flow.action({ action: 'download', ref: snap.controls.find(x => x.name === 'Download')!.ref });
    assert.match(JSON.stringify(download), /original\.svg/);
    const shot = await flow.screenshot();
    assert.ok(shot.length > 100);
  } finally { await browser?.close(); await rm(root, { recursive: true, force: true }); }
});

test('browser returns login requirement without exposing account fields', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://accounts.google.com/**', route => route.fulfill({ body: '<input value="private@example.com">' }));
    await page.goto('https://accounts.google.com/login');
    const snap = await new FlowPage(page, tmpdir()).snapshot();
    assert.equal(snap.loginRequired, true);
    assert.deepEqual(snap.controls, []);
    assert.doesNotMatch(snap.text, /private@/);
  } finally { await browser.close(); }
});

test('payment guard honors aria-labelledby just like the control snapshot', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://labs.google/**', route => route.fulfill({ contentType: 'text/html', body: '<span id="buy">Buy credits</span><button style="width:100px;height:40px" aria-labelledby="buy" onclick="document.body.dataset.paid=1"><svg/></button>' }));
    await page.goto('https://labs.google/test');
    const flow = new FlowPage(page, tmpdir());
    const snap = await flow.snapshot();
    await assert.rejects(flow.action({ action: 'click', ref: snap.controls[0].ref }), /PAYMENT_BLOCKED/);
    assert.equal(await page.getAttribute('body', 'data-paid'), null);
  } finally { await browser.close(); }
});

test('Flow popups become the active page and return to opener when closed', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.context().route('https://labs.google/**', route => route.fulfill({ contentType: 'text/html', body: '<a href="https://labs.google/result" target="_blank">Open result</a>' }));
    await page.goto('https://labs.google/start');
    const flow = new FlowPage(page, tmpdir());
    const snap = await flow.snapshot();
    await flow.action({ action: 'click', ref: snap.controls[0].ref });
    assert.equal((await flow.snapshot()).url, 'https://labs.google/result');
    await flow.page.close();
    assert.equal((await flow.snapshot()).url, 'https://labs.google/start');
  } finally { await browser.close(); }
});
