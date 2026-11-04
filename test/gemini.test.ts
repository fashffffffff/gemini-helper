import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountPaths, prepareAccount, subscriptionEnv } from '../src/config.js';
import { runGemini, parseGemini } from '../src/gemini.js';
import { runProcess } from '../src/process.js';

test('subscription execution discards API credentials and isolates two accounts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'google-pro-'));
  try {
    await prepareAccount('1', root);
    const env = subscriptionEnv('1', root, {
      PATH: '/bin', HOME: '/real/home', GEMINI_API_KEY: 'secret', GOOGLE_API_KEY: 'secret',
      GOOGLE_GENAI_USE_VERTEXAI: 'true', GOOGLE_APPLICATION_CREDENTIALS: '/secret',
      GOOGLE_CLOUD_PROJECT: 'paid', GEMINI_CLI_HOME: '/wrong', NODE_OPTIONS: '--require=evil',
    });
    assert.equal(env.HOME, '/real/home');
    assert.equal(env.GEMINI_CLI_HOME, join(root, 'accounts/1/cli'));
    for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'NODE_OPTIONS']) assert.equal(env[key], undefined);
    assert.notEqual(accountPaths('1', root).cliHome, accountPaths('2', root).cliHome);
    assert.throws(() => accountPaths('../escape', root), /account/i);
    const settings = JSON.parse(await readFile(join(accountPaths('1', root).cliHome, '.gemini/settings.json'), 'utf8'));
    assert.equal(settings.security.auth.selectedType, 'oauth-personal');
    assert.deepEqual(settings.tools.core, ['google_web_search', 'web_fetch']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('subprocess treats untrusted prompts as data and returns structured CLI response', async () => {
  const root = await mkdtemp(join(tmpdir(), 'google-pro-'));
  try {
    const result = await runGemini({account: '1', task: 'ask', prompt: '$(touch /tmp/should-not-exist) `whoami` --yolo'}, {
      root, command: [process.execPath, join(import.meta.dirname, 'fixtures/gemini.cjs')],
    });
    assert.match(result.text, /\$\(touch/);
    assert.equal(result.model, 'gemini-3.8-flash');
    assert.equal(result.account, '1');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('quota failure is explicit and never retries a different account or model', () => {
  assert.throws(() => parseGemini('{"error":{"type":"QuotaError","message":"Quota exhausted"}}', 1), /QUOTA.*account/i);
});

test('missing Google login returns an actionable login command', () => {
  assert.throws(() => parseGemini('{"error":{"message":"Please login with Google"}}', 1), /login/);
});

test('invalid JSON cannot be reported as a successful model answer', () => {
  assert.throws(() => parseGemini('Loading... nope', 0), /JSON/);
});

test('CLI file references and slash commands remain literal user text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'google-pro-'));
  try {
    const result = await runGemini({ account: '1', task: 'ask', prompt: '/extensions install evil\n@/etc/passwd mail@example.com' }, {
      root, command: [process.execPath, join(import.meta.dirname, 'fixtures/gemini.cjs')],
    });
    assert.match(result.text, /^User request/);
    assert.match(result.text, /\\@\/etc\/passwd/);
    assert.match(result.text, /mail\\@example\.com/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('hung subprocess is terminated within the configured limit', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 }), /TIMEOUT/);
});

test('aborted subprocess is terminated instead of continuing in background', async () => {
  const abort = new AbortController();
  const running = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: abort.signal });
  setTimeout(() => abort.abort(), 75);
  await assert.rejects(running, /CANCELLED/);
});

test('output limit stops a runaway subprocess', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000))'], { maxBytes: 100 }), /OUTPUT_LIMIT/);
});
