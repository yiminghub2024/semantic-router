import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { readCompletion } from './stream.js';

const mediaTypes = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
};

export function loadMedia(paths) {
  let total = 0;
  return paths.map((path) => {
    const mime = mediaTypes[extname(path).toLowerCase()];
    if (!mime)
      throw new Error('Unsupported attachment extension: ' + extname(path));
    total += statSync(path).size;
    if (total > 32 * 1024 * 1024)
      throw new Error('Attachments exceed the 32 MiB client limit');
    const bytes = readFileSync(path);
    return {
      kind: mime.split('/')[0],
      mime,
      bytes,
      digest: createHash('sha256').update(bytes).digest('hex'),
    };
  });
}

async function request(service, path, body, extraHeaders = {}) {
  const key = service.apiKey || (service.keyEnv && process.env[service.keyEnv]);
  if (service.keyEnv && !key)
    throw new Error('Set ' + service.keyEnv + ' for ' + service.model);
  const headers = { 'content-type': 'application/json', ...extraHeaders };
  if (key) headers.authorization = 'Bearer ' + key;
  const response = await fetch(service.baseUrl.replace(/\/+$/, '') + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok)
    throw new Error(
      service.model + ' returned HTTP ' + response.status + ' on ' + path,
    );
  return response;
}

export async function post(service, path, body, extraHeaders) {
  return (await request(service, path, body, extraHeaders)).json();
}

// Only textual fields may cross from a completed turn into a new request.
function plain(text) {
  return text.replace(
    /data:[^\s;,]+;base64,[a-z0-9+/=_-]+/gi,
    '[archived inline data]',
  );
}
function previousPrompt(turn) {
  const kinds = turn.attachments.map((a) => a.kind);
  return (
    plain(turn.prompt) +
    (kinds.length ? '\n[Earlier attachments: ' + kinds.join(', ') + ']' : '')
  );
}
const size = (msg) => Buffer.byteLength(JSON.stringify(msg));

export function messagesFor(model, history, prompt, media) {
  if (media.some((file) => !model.inputs.includes(file.kind)))
    throw new Error('Model cannot read the current attachment');
  const current = { role: 'user', content: prompt };
  let left = model.textBudgetBytes - size(current);
  if (left < 0) throw new Error('Current prompt exceeds the model text budget');
  const messages = [current];
  for (const turn of [...history].reverse()) {
    const user = { role: 'user', content: previousPrompt(turn) };
    const assistant = { role: 'assistant', content: plain(turn.reply) };
    left -= size(user) + size(assistant) + 2;
    if (left < 0) break;
    messages.unshift(user, assistant);
  }
  if (media.length) {
    current.content = [
      { type: 'text', text: prompt },
      ...media.map((file) => {
        const type = file.kind + '_url';
        return {
          type,
          [type]: {
            url:
              'data:' + file.mime + ';base64,' + file.bytes.toString('base64'),
          },
        };
      }),
    ];
  }
  return messages;
}

export async function decide(service, state, questions, media = [], backend) {
  if (service.protocol !== 'systemone')
    throw new Error('Typed decisions require the systemone protocol');
  const body = { model: service.model, state, questions };
  const headers = {};
  if (media.length && backend === 'typesafe') {
    body.assets = {};
    body.state = { context: state, images: [] };
    headers['TypeSafe-Danger-Zone-Images'] = 'true';
    for (const file of media) {
      if (
        !['image/png', 'image/jpeg'].includes(file.mime) ||
        file.bytes.length > 16 * 1024 * 1024
      )
        throw new Error(
          'Jev decisions require PNG or JPEG images up to 16 MiB',
        );
      body.assets[file.digest] = {
        type: 'image',
        format: file.mime === 'image/png' ? 'png' : 'jpg',
        data_base64: file.bytes.toString('base64'),
      };
      body.state.images.push(file.digest);
    }
    if (size(body) > 32 * 1024 * 1024)
      throw new Error('TypeSafe request exceeds 32 MiB');
  } else if (media.length) {
    if (backend !== 'vllm')
      throw new Error('The local decision adapter accepts text state only');
    for (const file of media) {
      const field = file.kind === 'image' ? 'images' : 'videos';
      (body[field] ??= []).push(
        'data:' + file.mime + ';base64,' + file.bytes.toString('base64'),
      );
    }
  }
  const result = await post(service, '/systemone', body, headers);
  for (const id of Object.keys(questions)) {
    if (!result.answers?.[id] || result.answers[id].error)
      throw new Error('Missing or failed decision: ' + id);
  }
  return result.answers;
}

async function select(config, history, prompt, media, override) {
  const pool = Object.entries(config.models).filter(
    ([, m]) =>
      media.every((f) => m.inputs.includes(f.kind)) &&
      m.textBudgetBytes >= size({ role: 'user', content: prompt }),
  );
  const eligible = new Map(pool);
  if (!eligible.size)
    throw new Error('No configured model supports this input and text budget');
  if (override) {
    if (!eligible.has(override))
      throw new Error('Unknown or incompatible model: ' + override);
    return override;
  }
  // The managed pool routes internally; a singleton has no Choice to ask.
  if (pool.length === 1) return pool[0][0];
  const state = JSON.stringify({
    prompt: prompt.slice(0, 6000),
    attachments: media.map((f) => f.kind),
    previous: history
      .slice(-2)
      .map((t) => [
        previousPrompt(t).slice(0, 300),
        plain(t.reply).slice(0, 500),
      ]),
  });
  const criteria = Object.fromEntries(
    pool.map(([id, m]) => [id, m.description || m.model]),
  );
  let id;
  if (config.decision.protocol === 'systemone') {
    const answers = await decide(config.decision, state, {
      route: {
        type: 'choice',
        instructions:
          'Choose the best generation model for the current user request.',
        criteria,
      },
    });
    id = answers.route.choice;
  } else {
    const result = await post(config.decision, '/chat/completions', {
      model: config.decision.model,
      messages: [
        {
          role: 'system',
          content:
            'Return exactly one model ID from this catalog: ' +
            JSON.stringify(criteria),
        },
        { role: 'user', content: state },
      ],
    });
    id = result.choices?.[0]?.message?.content?.trim();
  }
  if (!eligible.has(id))
    throw new Error(
      'Decision service returned a model outside the eligible pool',
    );
  return id;
}

export async function ask(
  config,
  archive,
  session,
  prompt,
  media = [],
  override,
  options = {},
) {
  if (!session?.trim() || !prompt?.trim())
    throw new Error('A session and non-empty prompt are required');
  if (plain(prompt) !== prompt)
    throw new Error('Pass inline media as a file attachment');
  const history = archive.history(session);
  const id = await select(config, history, prompt, media, override);
  const model = config.models[id];
  const messages = messagesFor(model, history, prompt, media);
  const debug = config.backend === 'vllm' && options.showReason === true;
  const body = { model: model.model, messages };
  if (options.stream) body.stream = true;
  const response = await request(model, '/chat/completions', body,
    debug ? { 'X-Vsr-Debug': 'true' } : {});
  let completion;
  if (options.stream) {
    completion = await readCompletion(response, options.onText);
  } else {
    const result = await response.json();
    completion = { reply: result.choices?.[0]?.message?.content, model: result.model };
  }
  const { reply } = completion;
  if (typeof reply !== 'string' || !reply.trim())
    throw new Error('Generation service returned no text');
  const poolModel = config.backend === 'vllm' && response.headers.get('x-vsr-selected-model');
  const served = poolModel || (typeof completion.model === 'string' ? completion.model : model.model);
  const routing = debug ? {
    decision: response.headers.get('x-vsr-selected-decision'),
    trace: response.headers.get('x-vsr-trace'),
  } : undefined;
  archive.append({
    session,
    seq: (history.at(-1)?.seq ?? 0) + 1,
    prompt,
    reply,
    backend: config.backend,
    model: served,
    routing,
    media,
  });
  return { route: id, model: served, reply };
}
