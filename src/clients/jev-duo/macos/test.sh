#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
stage="$(mktemp -d)"
server=""
cleanup() {
  if [[ -n "$server" ]]; then kill "$server" 2>/dev/null || true; fi
  rm -rf "$stage"
}
trap cleanup EXIT
ditto -x -k "dist/JevDuo-macOS-$1.zip" "$stage"
resources="$stage/Jev Duo.app/Contents/Resources"
node="$stage/Jev Duo.app/Contents/MacOS/node"
export JEV_DATA_DIR="$stage/data"
"$node" --input-type=module - "$stage/port" <<'JS' &
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
const server = createServer(async (req,res) => {
  let text = '';
  for await (const chunk of req) text += chunk;
  const body = JSON.parse(text);
  if (!body.stream || req.headers['x-vsr-debug'] !== 'true' || req.headers.authorization !== 'Bearer fixture')
    return res.writeHead(400).end();
  res.writeHead(200,{'content-type':'text/event-stream','x-vsr-selected-model':'pool-model','x-vsr-trace':'algorithm=static'});
  for(const content of ['第一段','第二段']) {
    res.write('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n');
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  res.end('data: [DONE]\n\n');
});
server.listen(0,'127.0.0.1',()=>writeFileSync(process.argv[2],String(server.address().port)));
JS
server=$!
for i in {1..50}; do [[ -s "$stage/port" ]] && break; sleep .1; done
xcrun swiftc -swift-version 5 -parse-as-library macos/Services.swift macos/BridgeSmoke.swift -o "$stage/check"
"$stage/check" "$resources" "http://127.0.0.1:$(cat "$stage/port")/v1"
