import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
test('CLI persists a visual turn and routes the follow-up to a text worker', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'jev-cli-'));
  const calls = [];
  const server = createServer(async (req, res) => {
    let data = '';
    for await (const chunk of req) data += chunk;
    const body = JSON.parse(data);
    calls.push(body);
    const reply = req.url.endsWith('/systemone')
      ? { answers: { route: { type: 'choice', choice: 'writer' } } }
      : { choices: [{ message: { content: 'Blue' } }] };
    res.end(JSON.stringify(reply));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1';
  const config = join(dir, 'models.json');
  const worker = {
    baseUrl,
    model: 'writer',
    inputs: ['text'],
    textBudgetBytes: 4000,
  };
  writeFileSync(
    config,
    JSON.stringify({
      localDecision: { baseUrl, model: 'kev', protocol: 'systemone' },
      models: {
        writer: worker,
        reader: { ...worker, model: 'reader', inputs: ['text', 'image'] },
      },
    }),
  );
  const file = join(dir, 'blue.png');
  writeFileSync(
    file,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64'),
  );
  const entry = process.env.JEV_TEST_OPENCLAW
    ? [process.env.JEV_TEST_OPENCLAW, 'jev']
    : ['cli.js'];
  const run = (...args) =>
    exec(process.execPath, [...entry, ...args], {
      env: {
        ...process.env,
        JEV_CONFIG: config,
        JEV_DATA_DIR: dir,
        JEV_BACKEND: 'local',
      },
    });
  await run('ask', 'Identify color', '--session', 'demo', '--file', file);
  await run('ask', 'Summarize', '--session', 'demo');
  const { stdout } = await run('history', '--session', 'demo');
  assert.deepEqual(
    JSON.parse(stdout).map((row) => row.model),
    ['reader', 'writer'],
  );
  assert.ok(
    calls[0].messages[0].content[1].image_url.url.startsWith(
      'data:image/png;base64,',
    ),
  );
  assert.equal(calls[1].questions.route.type, 'choice');
  assert.ok(calls[2].messages.every((m) => typeof m.content === 'string'));
  assert.equal(calls[2].messages[1].content, 'Blue');
});
