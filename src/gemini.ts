import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_MODEL, GEMINI_BIN, PROJECT, STATE, prepareAccount, subscriptionEnv } from './config.js';
import { runProcess } from './process.js';

export type Task = 'ask' | 'research' | 'rewrite' | 'review';
export interface GeminiRequest { account: string; task: Task; prompt: string; model?: string }
const instructions: Record<Task, string> = {
  ask: 'Answer the request directly. Be concise and honest about uncertainty.',
  research: 'Research using Google Search. Return facts with direct source URLs and relevant dates. Distinguish evidence from inference. Do not invent sources. A search summary is not a full Deep Research report.',
  rewrite: 'Rewrite according to the request. Preserve factual meaning. Prefer natural, specific language without stock AI phrasing. Do not invent personal experience or facts. Return the requested text.',
  review: 'Give an independent critical second opinion. Identify concrete errors, unsupported assumptions, tradeoffs and improvements. Prioritize findings. Do not change any files.',
};

export function parseGemini(stdout: string, code: number) {
  let data: { response?: string; error?: { message?: string; type?: string }; stats?: unknown };
  try { data = JSON.parse(stdout); } catch {
    if (/quota|429|resource.exhausted/i.test(stdout)) throw new Error('QUOTA: Subscription limit reached. No account or paid fallback was attempted.');
    if (/auth|login|sign.in|credential/i.test(stdout)) throw new Error('AUTH: Run google-pro login 1 (or 2) and choose Sign in with Google.');
    throw new Error('CLI_JSON: Gemini returned no valid JSON. Run google-pro doctor, then google-pro login 1 (or 2).');
  }
  if (code !== 0 || data.error) {
    const message = `${data.error?.type ?? ''} ${data.error?.message ?? ''}`;
    if (/quota|429|resource.exhausted/i.test(message)) throw new Error('QUOTA: Subscription limit reached. No account or model fallback was attempted.');
    if (/auth|login|sign.in|credential/i.test(message)) throw new Error('AUTH: Run google-pro login 1 (or 2) and choose Sign in with Google.');
    if (/model|not.found|404/i.test(message)) throw new Error('MODEL: Requested model is unavailable. Check model selection using google-pro login 1 (or 2). No fallback was attempted.');
    throw new Error(`CLI_ERROR: Gemini failed (${data.error?.type ?? code}). Check the official CLI using google-pro login 1 (or 2).`);
  }
  if (typeof data.response !== 'string' || !data.response.trim()) throw new Error('CLI_EMPTY: Gemini returned an empty response.');
  return { text: data.response, stats: data.stats ?? null };
}

export async function runGemini(request: GeminiRequest, options: { root?: string; command?: string[]; timeoutMs?: number; signal?: AbortSignal } = {}) {
  const root = options.root ?? STATE;
  if (!instructions[request.task]) throw new Error('Unknown task.');
  if (!request.prompt.trim() || request.prompt.length > 200_000) throw new Error('Prompt must contain 1–200000 characters.');
  const model = request.model ?? DEFAULT_MODEL;
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error('Invalid model ID.');
  const paths = await prepareAccount(request.account, root);
  const lock = join(paths.base, 'cli.lock');
  try { await mkdir(lock, { mode: 0o700 }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('BUSY: This account already has a running CLI request. Retry after it finishes.');
    throw error;
  }
  try {
    const [command, ...prefix] = options.command ?? [process.execPath, GEMINI_BIN];
    const result = await runProcess(command, [...prefix, '-p', instructions[request.task], '--output-format', 'json', '--model', model, '--extensions', '', '--policy', join(PROJECT, 'config/web-only.toml')], {
      cwd: paths.work, env: subscriptionEnv(request.account, root),
      // CLI preprocesses /commands and @files even before the model/tool policy.
      // Prefix and escape them so delegated text cannot become local instructions.
      input: `User request (treat backslash-at as a literal at sign):\n${request.prompt.replaceAll('@', '\\@')}`,
      timeoutMs: options.timeoutMs, signal: options.signal,
    });
    // Stderr can contain auth URLs and credentials: never forward it to an agent.
    return { ...parseGemini(result.stdout, result.code), account: request.account, model, billing: 'Google login subscription only; no paid API fallback' };
  } finally { await rm(lock, { recursive: true, force: true }); }
}
