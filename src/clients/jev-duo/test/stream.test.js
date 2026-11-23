import test from 'node:test';
import assert from 'node:assert/strict';
import { ask } from '../src/agent.js';
import { Archive } from '../src/archive.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const model = { model:'auto',baseUrl:'http://example.test/v1',inputs:['text'],textBudgetBytes:4000 };
const config = { backend:'vllm',models:{ auto:model } };
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(),'jev-stream-'));
  const archive = new Archive(dir);
  t.after(() => { archive.close(); rmSync(dir,{recursive:true,force:true}); });
  return archive;
}

function events(done) {
  const packets = [
    ': keepalive', 'data: {"choices":[{"delta":{"reasoning":"private"}}]}',
    'data: {"choices":[{"delta":{"content":"你"}}]}',
    'data: {"choices":[{"delta":{"content":"好"}}]}', 'data: {"choices":[]}',
  ];
  if(done) packets.push('data: [DONE]');
  const bytes = Buffer.from(packets.join('\r\n\r\n')+'\r\n\r\n');
  return new ReadableStream({ start(c) {
    for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
    c.close();
  } });
}

for (const stream of [false,true]) for (const showReason of [false,true]) {
  test('stream='+stream+' debug='+showReason,async t=>{
    const archive = setup(t);
    const requests = [];
    t.mock.method(globalThis,'fetch',async (url,init)=>{
      requests.push(JSON.parse(init.body));
      assert.equal(init.headers['X-Vsr-Debug'],showReason?'true':undefined);
      assert.equal(requests.at(-1).stream,stream||undefined);
      return new Response(stream?events(true):JSON.stringify({model:'alias',choices:[{message:{content:'你好'}}]}),{
        headers:{ 'x-vsr-selected-model':'pool-model','x-vsr-selected-decision':'code','x-vsr-trace':'algorithm=static' },
      });
    });
    const deltas=[];
    const opts={ stream,showReason,onText:d=>deltas.push(d) };
    await ask(config,archive,'s','first',[],undefined,opts);
    assert.deepEqual(deltas,stream?['你','好']:[]);
    const [turn]=archive.history('s');
    assert.equal(turn.reply,'你好');assert.equal(turn.model,'pool-model');
    assert.equal(turn.trace,showReason?'algorithm=static':null);
    await ask(config,archive,'s','next',[],undefined,opts);
    assert.doesNotMatch(JSON.stringify(requests.at(-1)),/algorithm=static|private/);
  });
}
test('interrupted stream leaves no committed turn',async t=>{
  const archive=setup(t);
  t.mock.method(globalThis,'fetch',async()=>new Response(events(false)));
  await assert.rejects(ask(config,archive,'s','test',[],undefined,{stream:true}),/completion marker/);
  assert.deepEqual(archive.history('s'),[]);
});
