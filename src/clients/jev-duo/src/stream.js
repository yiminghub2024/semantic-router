// SSE events may cross network packets, including inside a UTF-8 character.
export async function readCompletion(response, onText) {
  const parts = [];
  let model;
  let pending = '';
  for await (const text of response.body.pipeThrough(new TextDecoderStream())) {
    pending += text;
    const events = pending.split(/\r?\n\r?\n/);
    pending = events.pop();
    for (const event of events) {
      const data = event.split(/\r?\n/).filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart()).join('\n');
      if (!data) continue;
      if (data === '[DONE]') return { reply: parts.join(''), model };
      const chunk = JSON.parse(data);
      if (chunk.error) throw new Error('The server reported a streaming failure.');
      if (typeof chunk.model === 'string') model = chunk.model;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length) {
        parts.push(delta);
        onText?.(delta);
      }
    }
  }
  throw new Error('The stream ended before the completion marker. This turn was not saved.');
}
