import {resolveChannel, downloadVerified} from '../glue/js/distribution.mjs';
import {AgentVmWasmHost} from '../glue/js/host.mjs';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [revision, receiptPath = 'target/cdn-receipt.json'] = process.argv.slice(2);
if (!/^[0-9a-f]{40}$/.test(revision ?? '')) throw Error('usage: node scripts/verify-cdn.mjs <public commit> [receipt.json]');
const receipt = {schema:1, repository:'yxsicd/agentvmrelease', revision, started_at:new Date().toISOString(), passed:false, channels:[]};
try {
  for (const channel of ['dev', 'main', 'prod']) {
    const downloads = [];
    const fetchImpl = async (url, options) => {
      const r = await fetch(url, options);
      const cors = r.headers.get('access-control-allow-origin');
      downloads.push({url, status:r.status, cors, content_type:r.headers.get('content-type')});
      if (cors !== '*') { await r.body?.cancel(); throw Error('anonymous browser CORS missing'); }
      return r;
    };
    const resolved = await resolveChannel(channel, {revision, fetchImpl});
    const m = resolved.manifest;
    const core = await downloadVerified(resolved.coreUrl, m.core, {fetchImpl});
    const hostBytes = await downloadVerified(resolved.hostUrl, m.distribution.host, {fetchImpl});
    const fixture = await downloadVerified(resolved.fixtureUrl, m.distribution.fixture, {fetchImpl});
    // Verify the local test Host equals the downloaded public Host before use.
    const localHost = await readFile('glue/js/host.mjs');
    if (createHash('sha256').update(localHost).digest('hex') !== createHash('sha256').update(hostBytes).digest('hex')) throw Error('test Host does not match publication');
    const {host, imports} = await AgentVmWasmHost.instantiate(core);
    if (imports.length || host.abiVersion() !== 5) throw Error('CDN ABI mismatch');
    const handle = host.createSession(fixture, 100000);
    let result;
    try {
      let state = 1, calls = 0;
      while (state === 1 && calls < 32) { state = host.run(handle, 1); calls++; }
      const stdout = new TextDecoder().decode(host.stdout(handle));
      const stderr = new TextDecoder().decode(host.stderr(handle));
      if (state !== 2 || host.exitCode(handle) !== 43 || stdout !== 'agentvm-real-elf-pass\n' || stderr !== '') throw Error('CDN real ELF mismatch');
      result = {exit:43, stdout, stderr, steps:Number(host.steps(handle)), calls};
    } finally { host.destroy(handle); }
    if (host.sessionCount()) throw Error('CDN session leak');
    receipt.channels.push({channel, manifest_url:resolved.manifestUrl, core_url:resolved.coreUrl,
      bytes:core.length, sha256:m.core.sha256, abi:5, imports:0, cleanup_sessions:0, result, downloads});
  }
  receipt.passed = true;
} catch (error) { receipt.error = String(error); throw error; }
finally {
  receipt.completed_at = new Date().toISOString();
  await mkdir(new URL('../', new URL(receiptPath, 'file://' + process.cwd() + '/')), {recursive:true});
  await writeFile(receiptPath, JSON.stringify(receipt,null,2) + '\n');
  console.log(JSON.stringify(receipt,null,2));
}
