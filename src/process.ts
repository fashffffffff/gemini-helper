import { spawn } from 'node:child_process';

export interface ProcessOptions {
  cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number;
  maxBytes?: number; signal?: AbortSignal;
}
export function runProcess(command: string, args: string[], options: ProcessOptions = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error('CANCELLED: Request cancelled.'));
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, failure: Error | undefined;
    let escalation: NodeJS.Timeout | undefined;
    const terminate = (reason: string) => {
      if (failure) return;
      failure = new Error(reason);
      const kill = (signal: NodeJS.Signals) => {
        try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch {}
      };
      kill('SIGTERM');
      escalation = setTimeout(() => kill('SIGKILL'), 700);
      escalation.unref();
    };
    const timer = setTimeout(() => terminate('TIMEOUT: Gemini stopped. Retry a smaller request.'), options.timeoutMs ?? 180_000);
    const abort = () => terminate('CANCELLED: Request cancelled.');
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    const collect = (kind: 'stdout' | 'stderr', chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > (options.maxBytes ?? 8_000_000)) return terminate('OUTPUT_LIMIT: Subprocess output exceeded limit.');
      if (kind === 'stdout') stdout += chunk; else stderr += chunk;
    };
    child.stdout.on('data', chunk => collect('stdout', chunk));
    child.stderr.on('data', chunk => collect('stderr', chunk));
    const clean = () => { clearTimeout(timer); if (escalation) clearTimeout(escalation); options.signal?.removeEventListener('abort', abort); };
    child.on('error', error => { clean(); reject(error); });
    child.on('close', code => { clean(); if (failure) reject(failure); else resolve({ stdout, stderr, code: code ?? 1 }); });
    child.stdin.on('error', () => {});
    child.stdin.end(options.input ?? '');
  });
}
