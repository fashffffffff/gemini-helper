import { randomUUID } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Page, ElementHandle } from 'playwright';

export const FLOW_URL = 'https://labs.google/fx/tools/flow';
export function allowedFlowUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['labs.google', 'labs.google.com', 'flow.google', 'flow.google.com'].includes(url.hostname);
  } catch { return false; }
}
export interface FlowAction {
  action: 'click' | 'fill' | 'press' | 'upload' | 'download' | 'scroll' | 'wait';
  ref?: string; text?: string; files?: string[]; direction?: 'up' | 'down'; seconds?: number;
}
export interface Control { ref: string; role: string; name: string; value?: string; disabled: boolean }
export interface Snapshot { url: string; title: string; text: string; controls: Control[]; loginRequired: boolean; downloads?: string[] }
const purchase = /\b(buy|purchase|pay|checkout|subscribe|upgrade|top.?up|billing|credit card)\b|купить|докупить|оплат|плат[её]ж|оформить подписку|улучшить тариф|повысить тариф|пополн|банковск.*карт/i;

export class FlowPage {
  private refs = new Map<string, ElementHandle<HTMLElement | SVGElement>>();
  private revision = randomUUID().slice(0, 8);
  constructor(public page: Page, readonly downloads: string) { this.watchPopups(page); }

  private watchPopups(page: Page) {
    page.on('popup', popup => {
      this.page = popup;
      this.watchPopups(popup);
      popup.on('close', () => { if (this.page === popup && !page.isClosed()) this.page = page; });
    });
  }

  private async invalidate() {
    for (const handle of this.refs.values()) await handle.dispose().catch(() => {});
    this.refs.clear(); this.revision = randomUUID().slice(0, 8);
  }

  async snapshot(): Promise<Snapshot> {
    await this.invalidate();
    const url = this.page.url();
    if (!allowedFlowUrl(url)) return { url, title: 'User sign-in required', text: 'Complete Google sign-in manually in the opened browser, then reopen Flow. Account pages are not exposed to the assistant.', controls: [], loginRequired: true };
    const controls: Control[] = [];
    const elements = await this.page.locator('button, a[href], input:not([type="hidden"]), textarea, select, [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="combobox"], [role="textbox"], [contenteditable="true"]').elementHandles() as ElementHandle<HTMLElement | SVGElement>[];
    for (const handle of elements) {
      if (controls.length >= 180) { await handle.dispose(); continue; }
      const visible = await handle.isVisible();
      const info = await handle.evaluate(el => {
        const html = el as HTMLElement;
        const labels = 'labels' in el ? Array.from((el as HTMLInputElement).labels ?? []).map(x => x.textContent ?? '').join(' ') : '';
        const labelledBy = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ');
        return {
          role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
          name: (el.getAttribute('aria-label') || labelledBy || labels || el.getAttribute('placeholder') || el.getAttribute('title') || html.innerText || el.textContent || '').trim().slice(0, 250),
          value: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? (el.type === 'password' ? undefined : el.value.slice(0, 300)) : undefined,
          disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
          type: el.getAttribute('type'),
        };
      });
      // File inputs can be hidden but still accept references via setInputFiles.
      if (!visible && info.type !== 'file') { await handle.dispose(); continue; }
      const ref = `${this.revision}-${controls.length + 1}`;
      this.refs.set(ref, handle);
      controls.push({ ref, role: info.type === 'file' ? 'file-input' : info.role, name: info.name, value: info.value, disabled: info.disabled });
    }
    return { url, title: await this.page.title(), text: (await this.page.locator('body').innerText()).slice(0, 18000), controls, loginRequired: false };
  }

  async screenshot() {
    if (!allowedFlowUrl(this.page.url())) throw new Error('LOGIN_REQUIRED: Complete Google sign-in manually.');
    return this.page.screenshot({ type: 'png', fullPage: false, timeout: 15000 });
  }

  async action(input: FlowAction): Promise<Snapshot> {
    if (!allowedFlowUrl(this.page.url())) throw new Error('LOGIN_REQUIRED: Complete Google sign-in manually in the browser.');
    let saved: string | undefined;
    if (input.action === 'wait') {
      await this.page.waitForTimeout(Math.min(15, Math.max(0.1, input.seconds ?? 2)) * 1000);
    } else if (input.action === 'scroll') {
      await this.page.mouse.wheel(0, input.direction === 'up' ? -650 : 650);
    } else {
      const handle = this.refs.get(input.ref ?? '');
      if (!handle || !await handle.evaluate(el => el.isConnected)) throw new Error('STALE_REF: Read a fresh Flow snapshot and use its control refs.');
      const context = await handle.evaluate(el => {
        const dialog = el.closest('[role="dialog"], form');
        const labelledBy = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ');
        const labels = 'labels' in el ? Array.from((el as HTMLInputElement).labels ?? []).map(x => x.textContent ?? '').join(' ') : '';
        return `${el.getAttribute('aria-label') ?? ''} ${labelledBy} ${labels} ${el.getAttribute('title') ?? ''} ${el.textContent ?? ''} ${el.getAttribute('href') ?? ''} ${dialog?.textContent?.slice(0, 2000) ?? ''}`;
      });
      if (purchase.test(context) || /payments\.google|pay\.google|one\.google.*(checkout|upgrade)/i.test(context)) throw new Error('PAYMENT_BLOCKED: Purchases, upgrades and top-ups are disabled. Use only included subscription allowance.');
      switch (input.action) {
        case 'click': {
          const popup = this.page.waitForEvent('popup', { timeout: 600 }).catch(() => null);
          await handle.click({ timeout: 15000 });
          const opened = await popup;
          if (opened) this.page = opened;
          break;
        }
        case 'fill':
          if (input.text === undefined || input.text.length > 30000) throw new Error('Text must contain at most 30000 characters.');
          await handle.fill(input.text, { timeout: 15000 }); break;
        case 'press':
          if (!['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Space'].includes(input.text ?? '')) throw new Error('Unsupported key.');
          await handle.press(input.text!, { timeout: 15000 }); break;
        case 'upload': {
          if (!input.files?.length || input.files.length > 8) throw new Error('Provide 1–8 absolute reference file paths.');
          for (const file of input.files) {
            if (!file.startsWith('/') || !/\.(png|jpe?g|webp|gif|mp4|webm|mov|mp3|wav|m4a)$/i.test(file)) throw new Error('Only absolute paths to media reference files are allowed.');
            const info = await stat(file);
            if (!info.isFile() || info.size > 100_000_000) throw new Error('Reference file must be a regular media file smaller than 100 MB.');
          }
          if (await handle.evaluate(el => el instanceof HTMLInputElement && el.type === 'file')) await handle.setInputFiles(input.files);
          else {
            const chooser = this.page.waitForEvent('filechooser', { timeout: 15000 });
            await handle.click();
            await (await chooser).setFiles(input.files);
          }
          break;
        }
        case 'download': {
          await mkdir(this.downloads, { recursive: true, mode: 0o700 });
          const waiting = this.page.waitForEvent('download', { timeout: 25000 });
          await handle.click();
          const download = await waiting;
          const filename = basename(download.suggestedFilename()).replace(/[^\p{L}\p{N}._-]/gu, '_').slice(-140) || 'media';
          saved = join(this.downloads, `${Date.now()}-${randomUUID().slice(0, 6)}-${filename}`);
          await download.saveAs(saved);
          break;
        }
      }
    }
    // A click can start navigation; a short DOM wait is bounded, never a long generation wait.
    await this.page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
    const result = await this.snapshot();
    if (saved) result.downloads = [saved];
    return result;
  }
}
