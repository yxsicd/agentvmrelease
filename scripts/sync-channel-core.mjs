// Distribution-only: never rebuild or promote a channel.
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AgentVmWasmHost } from '../glue/js/host.mjs';

const channels = process.argv.slice(2);
if (!channels.length || channels.some(c => !['dev', 'main', 'prod'].includes(c))) {
  throw Error('usage: node scripts/sync-channel-core.mjs dev [main prod]');
}
const pending = [];
for (const channel of new Set(channels)) {
  const m = JSON.parse(await readFile(`channels/${channel}.json`, 'utf8'));
  if (m.public_qualification?.result !== 'pass' || m.core?.abi !== 5 ||
      m.core.imports !== 0 || !Number.isSafeInteger(m.core.bytes) || m.core.bytes < 8 ||
      m.core.bytes > 8 * 1048576 || !/^[0-9a-f]{64}$/.test(m.core.sha256) ||
      !/^[A-Za-z0-9._-]+$/.test(m.release_tag) ||
      m.core.download !== `https://github.com/yxsicd/agentvmrelease/releases/download/${m.release_tag}/agentvm-core.wasm` ||
      m.core.repository_path !== `channels/${channel}/agentvm-core.wasm`) {
    throw Error('unqualified or invalid channel: ' + channel);
  }
  const r = await fetch(m.core.download, { signal: AbortSignal.timeout(30000) });
  if (!r.ok || !r.body) throw Error('release download failed: ' + r.status);
  const reader = r.body.getReader(), bytes = new Uint8Array(m.core.bytes);
  let used = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      if (used + value.length > bytes.length) throw Error('Core exceeds manifest bytes');
      bytes.set(value, used); used += value.length;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (used !== m.core.bytes || sha256 !== m.core.sha256) throw Error('release integrity mismatch');
  const module = await WebAssembly.compile(bytes);
  const {host, imports} = await AgentVmWasmHost.instantiateModule(module);
  if (imports.length || host.abiVersion() !== 5 || host.sessionCount()) throw Error('ABI/import/session mismatch');
  await mkdir('release-input/repository-sync', {recursive:true});
  const temp = `release-input/repository-sync/${channel}.wasm`;
  await writeFile(temp, bytes);
  pending.push({channel, temp, path:m.core.repository_path, bytes:used, sha256});
}
// All inputs verified before any current-channel replacement.
for (const item of pending) {
  await mkdir(`channels/${item.channel}`, {recursive:true});
  await rename(item.temp, item.path);
}
console.log(JSON.stringify({ok:true, rebuilt:false, promoted:false, channels:pending}, null, 2));
