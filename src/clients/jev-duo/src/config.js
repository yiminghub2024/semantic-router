import { readFileSync } from 'node:fs';

const duo = { baseUrl: 'https://app.vllm-sr.ai/v1', keyEnv: 'VLLM_SR_API_KEY' };
const presets = {
  vllm: { ...duo, model: 'vllm-sr/d3-flash', protocol: 'systemone' },
  typesafe: {
    baseUrl: 'https://api.typesafe.ai/v1',
    keyEnv: 'TYPESAFE_API_KEY',
    model: 'jev-latest',
    protocol: 'systemone',
  },
};
const duoModels = {
  auto: {
    ...duo,
    model: 'vllm-sr/auto',
    description: 'System Two routed chat',
    inputs: ['text', 'image'],
    textBudgetBytes: 64000,
  },
};

function endpoint(value, label) {
  if (!value?.model || typeof value.model !== 'string')
    throw new Error(label + ' requires a model ID');
  const url = new URL(value.baseUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      label +
        ' requires an HTTP(S) base URL without credentials, query or fragment',
    );
  if (
    value.keyEnv !== undefined &&
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.keyEnv)
  )
    throw new Error(label + ' requires an environment variable name in keyEnv');
}

export function settings(backend, path, needsModels = true) {
  const config = path
    ? JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
    : {};
  if (!['local', 'vllm', 'typesafe'].includes(backend))
    throw new Error('Choose vllm, typesafe or local');
  const decision =
    backend === 'local' ? config.localDecision : presets[backend];
  const models = backend === 'vllm' ? duoModels : (config.models ?? {});
  return validateConfig({ backend, decision, models }, needsModels);
}

export function validateConfig({ backend, decision, models }, needsModels = true) {
  endpoint(decision, 'Decision service');
  if (!['systemone', 'chat'].includes(decision.protocol))
    throw new Error('Decision protocol must be systemone or chat');
  if (needsModels && !Object.keys(models).length)
    throw new Error(
      'Configure generation endpoints with --config examples/models.json',
    );
  for (const [id, model] of Object.entries(models)) {
    endpoint(model, id);
    if (
      !Array.isArray(model.inputs) ||
      !model.inputs.includes('text') ||
      model.inputs.some((k) => !['text', 'image', 'video'].includes(k))
    )
      throw new Error(id + ' requires valid inputs including text');
    if (
      !Number.isSafeInteger(model.textBudgetBytes) ||
      model.textBudgetBytes < 512
    )
      throw new Error(id + ' requires textBudgetBytes >= 512');
  }
  return { backend, decision, models };
}
