import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { installJsonConfig, connectionConfig, setCodexTimeout } from '../src/install.js';

test('client installation preserves unrelated servers and makes a recoverable backup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'google-install-'));
  const file = join(dir, 'claude.json');
  const before = JSON.stringify({ preferences: { dark: true }, mcpServers: { existing: { command: 'keep-me' } } });
  try {
    await writeFile(file, before);
    const result = await installJsonConfig(file);
    const after = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(after.preferences.dark, true);
    assert.equal(after.mcpServers.existing.command, 'keep-me');
    assert.equal(after.mcpServers['google-pro'].command, process.execPath);
    assert.equal(await readFile(result.backup!, 'utf8'), before);
    assert.equal(connectionConfig().args[0].endsWith(sep + join('dist', 'server.js')), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('malformed existing client config is never overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'google-install-'));
  const file = join(dir, 'broken.json');
  try {
    await writeFile(file, '{broken');
    await assert.rejects(installJsonConfig(file), /JSON/);
    assert.equal(await readFile(file, 'utf8'), '{broken');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Codex timeout update affects only this server and preserves unrelated TOML', () => {
  const before = '# keep\n[mcp_servers.other]\ncommand = "other"\n\n[mcp_servers.google-pro]\ncommand = "node"\nargs = ["server.js"]\n\n[features]\nx = true\n';
  const after = setCodexTimeout(before);
  assert.match(after, /\[mcp_servers.google-pro\]\ntool_timeout_sec = 240\n/);
  assert.match(after, /^# keep\n\[mcp_servers.other\]\ncommand = "other"/);
  assert.match(after, /\[features\]\nx = true/);
  assert.equal(setCodexTimeout(after), after);
});
