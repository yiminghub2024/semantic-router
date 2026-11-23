import { homedir } from 'node:os';
import { join } from 'node:path';
import { ask, decide, loadMedia } from '../src/agent.js';
import { Archive } from '../src/archive.js';
import { validateConfig } from '../src/config.js';
import translations from '../src/ui.zh-CN.json' with { type: 'json' };

// One child per operation. Requests and credentials travel over anonymous pipes.
async function run(req) {
  const archive = new Archive(process.env.JEV_DATA_DIR || join(homedir(), '.jev-duo'));
  try {
    if (req.action === 'sessions') return archive.sessions();
    if (req.action === 'history') return archive.history(req.session);
    if (!['ask','judge'].includes(req.action)) throw new Error('Unknown operation');
    const { profile } = req;
    const models = Object.fromEntries(profile.workers.map(w => [w.alias, w]));
    const config = { backend:profile.id, decision:profile.decision, models };
    validateConfig(config, req.action === 'ask');
    const media = loadMedia(req.files || []);
    if (req.action === 'ask') {
      return await ask(config,archive,req.session,req.prompt,media,req.override,{
        stream:req.stream === true, showReason:req.showReason === true,
        onText:delta => console.log(JSON.stringify({ delta })),
      });
    }
    const seq = (archive.history(req.session).at(-1)?.seq ?? 0) + 1;
    const answers = await decide(config.decision, req.prompt, { judgment:{ type:'noul', instructions:req.prompt } }, media,config.backend);
    const probability = answers.judgment.noul;
    if (typeof probability !== 'number' || probability < 0 || probability > 1) throw new Error('The decision service returned an invalid probability.');
    const label = req.language === 'zh-CN' ? translations['Probability of yes'] + '：' : 'Probability of yes: ';
    const reply = label + (100 * probability).toFixed(1) + '%';
    archive.append({ session:req.session,seq,prompt:req.prompt,reply,backend:profile.id,model:config.decision.model,media });
    return { reply, model:config.decision.model };
  } finally { archive.close(); }
}

let language;
try {
  process.stdin.setEncoding('utf8');
  let input = '';
  for await (const part of process.stdin) input += part;
  const request = JSON.parse(input);
  language = request.language;
  console.log(JSON.stringify({ value:await run(request) }));
} catch (e) {
  const error = language === 'zh-CN' ? translations[e.message] ?? e.message : e.message;
  console.log(JSON.stringify({ error }));
  process.exitCode = 1;
}
