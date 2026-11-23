import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Archive } from '../src/archive.js';
import { ask, decide, messagesFor } from '../src/agent.js';
import { settings } from '../src/config.js';

async function fixture(t) {
  const calls = [];
  const server = createServer(async (req, res) => {
    let data = '';
    for await (const chunk of req) data += chunk;
    const body = JSON.parse(data);
    calls.push({ path: req.url, body, headers: req.headers });
    res.setHeader('content-type', 'application/json');
    const choice = body.state?.includes?.('invalid route')
      ? 'unknown'
      : 'writer';
    if (req.url.endsWith('/systemone'))
      res.end(
        JSON.stringify({ answers: { route: { type: 'choice', choice } } }),
      );
    else if (body.model === 'broken') {
      res.statusCode = 503;
      res.end('{}');
    } else {
      const reply = body.model === 'router' ? 'writer' : '识别结果是蓝色';
      res.end(
        JSON.stringify({
          model: body.model,
          choices: [{ message: { content: reply } }],
        }),
      );
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1';
  const dir = mkdtempSync(join(tmpdir(), 'jev-test-'));
  const archive = new Archive(dir);
  t.after(async () => {
    archive.close();
    rmSync(dir, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  });
  const writer = {
    baseUrl,
    model: 'text',
    inputs: ['text'],
    textBudgetBytes: 4000,
  };
  const config = {
    backend: 'local',
    decision: { baseUrl, model: 'router', protocol: 'systemone' },
    models: {
      writer,
      vision: {
        ...writer,
        model: 'vision',
        inputs: ['text', 'image', 'video'],
      },
    },
  };
  return { archive, dir, config, calls };
}

for (const kind of ['image', 'video']) {
  test(kind + ' -> text across sessions and a reopened archive', async (t) => {
    const { dir, archive, config, calls } = await fixture(t);
    const mime = kind === 'image' ? 'image/png' : 'video/mp4';
    const media = [
      {
        kind,
        mime,
        bytes: Buffer.from('PRIVATE_FILE_BYTES'),
        digest: 'testdigest',
      },
    ];
    await ask(config, archive, 'demo', '看附件', media);
    assert.equal(calls[0].body.messages[0].content[1].type, kind + '_url');
    const reopened = new Archive(dir);
    try {
      const answer = await ask(config, reopened, 'demo', '上一轮是什么颜色？');
      assert.equal(answer.route, 'writer');
      assert.deepEqual(
        calls.map((c) => c.path),
        ['/v1/chat/completions', '/v1/systemone', '/v1/chat/completions'],
      );
      const messages = calls.at(-1).body.messages;
      assert.ok(messages.every((m) => typeof m.content === 'string'));
      assert.equal(messages[1].content, '识别结果是蓝色');
      assert.ok(
        !JSON.stringify(calls.slice(1)).includes(
          media[0].bytes.toString('base64'),
        ),
      );
      assert.equal(reopened.history('demo')[0].attachments[0].mime, mime);
      await ask(config, reopened, 'another', '单独的会话', [], 'writer');
      assert.equal(calls.at(-1).body.messages.length, 1);
    } finally {
      reopened.close();
    }
  });
}

test('all generation paths reject incompatible, unknown and failed responses atomically', async (t) => {
  const { archive, config, calls } = await fixture(t);
  await assert.rejects(
    ask(config, archive, 's', 'video', [{ kind: 'video' }], 'writer'),
    /incompatible/,
  );
  assert.equal(calls.length, 0);
  await assert.rejects(
    ask(config, archive, 's', 'invalid route'),
    /eligible pool/,
  );
  config.models.writer.model = 'broken';
  await assert.rejects(
    ask(config, archive, 's', 'question', [], 'writer'),
    /503/,
  );
  assert.deepEqual(archive.history('s'), []);
});

test('chat-compatible decision model', async (t) => {
  const { archive, config, calls } = await fixture(t);
  config.decision.protocol = 'chat';
  assert.equal((await ask(config, archive, 's', 'hello')).route, 'writer');
  assert.equal(calls[0].path, '/v1/chat/completions');
});

test('hosted presets and their native media contracts', async (t) => {
  const { config, calls } = await fixture(t);
  const questions = {
    route: {
      type: 'choice',
      instructions: 'choose',
      criteria: { writer: 'write', vision: 'look' },
    },
  };
  const file = {
    kind: 'image',
    mime: 'image/png',
    bytes: Buffer.from('pixel'),
    digest: 'image1',
  };
  for (const backend of ['typesafe', 'vllm']) {
    const preset = settings(backend, undefined, false);
    assert.equal(
      preset.decision.baseUrl,
      backend === 'vllm'
        ? 'https://app.vllm-sr.ai/v1'
        : 'https://api.typesafe.ai/v1',
    );
    await decide(
      {
        ...preset.decision,
        baseUrl: config.decision.baseUrl,
        keyEnv: undefined,
      },
      'sample',
      questions,
      [file],
      backend,
    );
    const call = calls.at(-1);
    if (backend === 'typesafe') {
      assert.equal(call.headers['typesafe-danger-zone-images'], 'true');
      assert.equal(call.body.assets.image1.format, 'png');
      assert.deepEqual(call.body.state.images, ['image1']);
    } else assert.ok(call.body.images[0].startsWith('data:image/png;base64,'));
  }
});

test('context pruning removes whole pairs and stale writers cannot commit', async (t) => {
  const { archive } = await fixture(t);
  const turn = {
    seq: 1,
    session: 'one',
    prompt: 'x'.repeat(800),
    reply: 'ok',
    backend: 'local',
    model: 'text',
    media: [],
  };
  archive.append(turn);
  assert.throws(() => archive.append(turn), /changed/);
  assert.equal(
    messagesFor({ textBudgetBytes: 512 }, archive.history('one'), 'new', [])
      .length,
    1,
  );
  assert.equal(archive.history('one').length, 1);
});
