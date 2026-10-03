// Browser/Node/Bun/Deno acquisition only; no capability or runtime changes.
const REPO = 'yxsicd/agentvmrelease';
const CDN = 'https://cdn.jsdelivr.net/gh/' + REPO + '@';
const COMMIT = /^[0-9a-f]{40}$/;
const SHA = /^[0-9a-f]{64}$/;

export async function boundedBytes(response, maximum) {
  if (!response.ok || !response.body) throw Error('download failed: ' + response.status);
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw Error('download byte budget exceeded');
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
    return out;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function resolveChannel(channel, {
  revision, fetchImpl = globalThis.fetch, signal = AbortSignal.timeout(20000),
} = {}) {
  if (!['dev', 'main', 'prod'].includes(channel)) throw Error('invalid channel');
  const options = {credentials:'omit', mode:'cors', redirect:'error', signal};
  if (!revision) {
    const response = await fetchImpl('https://api.github.com/repos/' + REPO + '/commits/main',
      {...options, cache:'no-store'});
    const info = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 262144)));
    revision = info.sha;
  }
  if (!COMMIT.test(revision ?? '')) throw Error('exact public commit required');
  const manifestUrl = CDN + revision + '/channels/' + channel + '.json';
  const response = await fetchImpl(manifestUrl, {...options, cache:'force-cache'});
  const manifest = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 65536)));
  const core = manifest.core, distribution = manifest.distribution;
  if (manifest.channel !== channel || manifest.public_qualification?.result !== 'pass' ||
      core?.abi !== 5 || core.imports !== 0 || !SHA.test(core.sha256) ||
      !Number.isSafeInteger(core.bytes) || core.bytes < 8 || core.bytes > 8 * 1048576 ||
      core.repository_path !== 'channels/' + channel + '/agentvm-core.wasm' ||
      distribution?.schema !== 'agentvm.repository-distribution/v1') throw Error('invalid channel manifest');
  for (const [asset, path] of [[distribution.host, 'glue/js/host.mjs'],
                             [distribution.fixture, 'fixtures/exit43.elf']]) {
    if (asset?.path !== path || !SHA.test(asset.sha256) ||
        !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > 1048576) {
      throw Error('invalid Host/fixture identity');
    }
  }
  return {revision, manifest, manifestUrl, coreUrl:CDN + revision + '/' + core.repository_path,
    hostUrl:CDN + revision + '/' + distribution.host.path,
    fixtureUrl:CDN + revision + '/' + distribution.fixture.path};
}

export async function downloadVerified(url, identity, {
  fetchImpl = globalThis.fetch, signal = AbortSignal.timeout(20000),
} = {}) {
  if (!/^https:\/\/cdn\.jsdelivr\.net\/gh\/yxsicd\/agentvmrelease@[0-9a-f]{40}\/[A-Za-z0-9._/-]+$/.test(url) ||
      !SHA.test(identity?.sha256) || !Number.isSafeInteger(identity.bytes) ||
      identity.bytes < 1 || identity.bytes > 8 * 1048576) throw Error('pinned identity required');
  const response = await fetchImpl(url, {mode:'cors', credentials:'omit',
    redirect:'error', cache:'force-cache', signal});
  const bytes = await boundedBytes(response, identity.bytes);
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  if (bytes.length !== identity.bytes || digest !== identity.sha256) throw Error('digest/size mismatch');
  return bytes;
}
