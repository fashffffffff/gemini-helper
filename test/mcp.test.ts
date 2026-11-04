import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'node:path';

test('MCP lists tools, reports subscription-only mode and validates account inputs', async () => {
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(import.meta.dirname, '../dist/server.js')], stderr: 'pipe' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(x => x.name).sort(), ['google_delegate', 'google_flow', 'google_gemini', 'google_image', 'google_media', 'google_status']);
    const status = await client.callTool({ name: 'google_status', arguments: {} });
    assert.match(JSON.stringify(status), /no paid API/i);
    const invalid = await client.callTool({ name: 'google_gemini', arguments: { account: '../bad', task: 'ask', prompt: 'hello' } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); }
});
