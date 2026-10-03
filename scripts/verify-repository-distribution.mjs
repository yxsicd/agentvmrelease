import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {AgentVmWasmHost} from '../glue/js/host.mjs';
const receipts = [];
for (const channel of ['dev', 'main', 'prod']) {
  const m = JSON.parse(await readFile(`channels/${channel}.json`, 'utf8'));
  if (m.channel !== channel || m.public_qualification?.result !== 'pass' ||
      m.distribution?.schema !== 'agentvm.repository-distribution/v1' ||
      m.core.repository_path !== `channels/${channel}/agentvm-core.wasm`) throw Error('invalid manifest');
  const files = await readdir(`channels/${channel}`);
  if (files.filter(f => f.endsWith('.wasm')).join() !== 'agentvm-core.wasm') throw Error('one current Wasm per channel required');
  for (const identity of [{...m.core, path:m.core.repository_path}, m.distribution.host, m.distribution.fixture]) {
    const bytes = await readFile(identity.path);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== identity.bytes || sha !== identity.sha256) throw Error('repository identity mismatch: ' + identity.path);
  }
  const core = await readFile(m.core.repository_path);
  const {host, imports} = await AgentVmWasmHost.instantiate(core);
  if (m.core.abi !== 5 || host.abiVersion() !== 5 || m.core.imports !== 0 || imports.length || host.sessionCount()) throw Error('ABI mismatch');
  receipts.push({channel, path:m.core.repository_path, sha256:m.core.sha256, bytes:core.length, abi:5, imports:0});
}
console.log(JSON.stringify({ok:true, receipts}, null, 2));
