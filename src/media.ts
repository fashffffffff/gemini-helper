import { readdir, stat, readFile, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute, extname } from 'node:path';
import { accountPaths } from './config.js';

export async function listMedia(account: string) {
  const root = accountPaths(account).downloads;
  const names = await readdir(root).catch(() => [] as string[]);
  const files = await Promise.all(names.map(async name => {
    const path = join(root, name), info = await stat(path);
    return { path, bytes: info.size, modified: info.mtime.toISOString(), time: info.mtimeMs };
  }));
  return files.sort((a,b) => b.time - a.time).slice(0, 50).map(({time, ...file}) => file);
}

export async function previewMedia(account: string, file: string) {
  const root = await realpath(accountPaths(account).downloads), resolved = await realpath(file);
  const rel = relative(root, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Only files downloaded by Flow for this account can be previewed.');
  const mimeType = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' } as Record<string,string>)[extname(resolved).toLowerCase()];
  if (!mimeType) throw new Error('Inline previews support PNG/JPEG/WebP. Use the local path for video and other files.');
  if ((await stat(resolved)).size > 15_000_000) throw new Error('Image is larger than the 15 MB preview limit. Use the local path.');
  return { type: 'image' as const, mimeType, data: (await readFile(resolved)).toString('base64') };
}
