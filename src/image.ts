import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runAntigravity } from './antigravity.js';
import { STATE } from './config.js';

const limit = 15_000_000;

export function imageFormat(data: Buffer) {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { ext: 'png', mimeType: 'image/png' };
  if (data.length >= 4 && data[0] === 255 && data[1] === 216 && data[2] === 255) return { ext: 'jpg', mimeType: 'image/jpeg' };
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mimeType: 'image/webp' };
}

async function readGeneratedImage(directory: string) {
  const root = await realpath(directory).catch(() => undefined);
  if (!root) return;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(png|jpe?g|webp)$/i.test(entry.name)) continue;
    const path = join(root, entry.name);
    if (dirname(await realpath(path)) !== root) continue;
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > limit) continue;
      const data = await file.readFile();
      if (data.length > limit) continue;
      const format = imageFormat(data);
      if (format) return { data, ...format };
    } finally {
      await file.close();
    }
  }
}

export async function generateImage(prompt: string, signal?: AbortSignal) {
  const work = await mkdtemp(join(tmpdir(), 'google-pro-image-'));
  try {
    const result = await runAntigravity(
      'Use the built-in Antigravity image generation capability once. Generate one image for the brief below. Keep the result as its native conversation artifact. Do not copy or convert it. Do not use shell commands, external tools, SVG drawing or code as a substitute. If generation fails, report the error.\n\n' + prompt,
      work, signal,
    );
    let image = await readGeneratedImage(work);
    const id = result.conversation_id;
    if (!image && id && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
      const brain = await realpath(join(homedir(), '.gemini/antigravity-cli/brain')).catch(() => undefined);
      if (brain) {
        const artifacts = await realpath(join(brain, id)).catch(() => undefined);
        if (artifacts && dirname(artifacts) === brain) image = await readGeneratedImage(artifacts);
      }
    }
    if (!image) {
      if (/429|resource.exhausted|quota|capacity/i.test(result.response ?? '')) {
        throw new Error('Google image quota or capacity exhausted (429). Try again later.');
      }
      throw new Error('Antigravity returned no PNG, JPEG or WebP image under 15 MB.');
    }
    const folder = join(STATE, 'images');
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const path = join(folder, `${randomUUID()}.${image.ext}`);
    await writeFile(path, image.data, { flag: 'wx', mode: 0o600 });
    return { path, mimeType: image.mimeType, data: image.data.toString('base64') };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
