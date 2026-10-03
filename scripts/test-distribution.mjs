import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolveChannel, downloadVerified, boundedBytes} from '../glue/js/distribution.mjs';
const revision = 'a'.repeat(40), m = JSON.parse(await readFile('channels/prod.json','utf8'));
test('all assets use the one discovered immutable manifest commit', async () => {
  const urls = [];
  const r = await resolveChannel('prod', {fetchImpl:async (url, options) => {
    urls.push(url); assert.equal(options.credentials,'omit'); assert.equal(options.redirect,'error');
    return new Response(JSON.stringify(url.includes('api.github.com') ? {sha:revision} : m));
  }});
  assert.equal(r.revision, revision);
  for (const url of [r.manifestUrl,r.coreUrl,r.hostUrl,r.fixtureUrl]) assert(url.includes('@'+revision+'/'));
  assert.equal(urls.length,2);
});
test('moving refs, unknown channels, wrong identity and oversized streams fail', async () => {
  await assert.rejects(resolveChannel('prod',{revision:'main'}), /commit/);
  await assert.rejects(resolveChannel('other',{revision}), /channel/);
  for (const mutate of [
    x=>{x.core.repository_path='channels/dev/agentvm-core.wasm';},
    x=>{x.core.bytes=9*1048576;},
    x=>{x.core.abi=6;},
    x=>{x.distribution.host.sha256='bad';},
    x=>{x.public_qualification.result='failure';},
  ]) {
    const broken=structuredClone(m); mutate(broken);
    await assert.rejects(resolveChannel('prod',{revision,fetchImpl:async()=>new Response(JSON.stringify(broken))}), /manifest|identity/);
  }
  await assert.rejects(boundedBytes(new Response(new Uint8Array(9)),8), /budget/);
  await assert.rejects(boundedBytes(new Response(null,{status:404}),8), /download/);
});
test('exact digest/size, HTTP failure and cancellation remain enforced', async () => {
  const bytes = await readFile(m.core.repository_path);
  const url = 'https://cdn.jsdelivr.net/gh/yxsicd/agentvmrelease@'+revision+'/'+m.core.repository_path;
  assert.equal((await downloadVerified(url,m.core,{fetchImpl:async()=>new Response(bytes)})).length, m.core.bytes);
  await assert.rejects(downloadVerified(url,{...m.core,sha256:'0'.repeat(64)},{fetchImpl:async()=>new Response(bytes)}), /digest/);
  await assert.rejects(downloadVerified(url,m.core,{fetchImpl:async()=>new Response(bytes.subarray(0,8))}), /size/);
  await assert.rejects(downloadVerified(url.replace('@'+revision,'@main'),m.core), /pinned/);
  await assert.rejects(downloadVerified(url,m.core,{fetchImpl:async()=>new Response(null,{status:500})}), /download/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(downloadVerified(url,m.core,{signal:controller.signal}));
});
