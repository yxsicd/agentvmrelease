import { AgentVmWasmHost, createPortableRestart, restorePortableRestart,
  createPortableAgentSnapshot, restorePortableAgentSnapshot } from './host.mjs';

const args = globalThis.Deno?.args ?? process.argv.slice(2);
const read = async p => globalThis.Deno ? Deno.readFile(p) : new Uint8Array(await (await import('node:fs/promises')).readFile(p));
const [core, fixtureDir = 'fixtures'] = args;
const bytes = await read(core), elf = await read(`${fixtureDir}/exit43.elf`);
const checks = [], failures = [];
const check = (ok, name) => { if (!ok) throw Error(name); checks.push(name); };
const reject = (fn, name) => { let rejected = false; try { fn(); } catch { rejected = true; } check(rejected, name); };
const finish = (host, handle, expectedExit, expectedText) => {
  for (let i=0; i<100; i++) {
    const state = host.run(handle, 1000);
    if (state === 2) {
      check(host.exitCode(handle) === expectedExit && new TextDecoder().decode(host.stdout(handle)) === expectedText && host.stderr(handle).length === 0, 'exact-exit-output');
      return;
    }
    if (state !== 1) throw Error(`unexpected state ${state}`);
  }
  throw Error('bounded execution exhausted');
};
const {host} = await AgentVmWasmHost.instantiate(bytes);
check(host.abiVersion()===5 && WebAssembly.Module.imports(host.module).length===0, 'ABI5-zero-imports');
reject(()=>host.createSession(new Uint8Array([1,2,3])), 'invalid-ELF-rejected');
reject(()=>host.createSessionWithArgv(elf, []), 'empty-argv-rejected');
reject(()=>host.createSessionWithArgv(elf, ['a\0b']), 'NUL-argv-rejected');
reject(()=>host.createSessionWithArgv(elf, ['x'.repeat(4097)]), 'oversized-argv-rejected');
check(host.sessionCount()===0, 'invalid-create-no-session-leak');
const a=host.createSessionWithArgv(elf,['fixture','one']), b=host.createSession(elf);
try {
  check(a!==b && host.sessionCount()===2, 'independent-live-sessions');
  finish(host,a,43,'agentvm-real-elf-pass\n');
  check(host.steps(b)===0n && host.stdout(b).length===0, 'no-cross-session-state');
  finish(host,b,43,'agentvm-real-elf-pass\n');
} finally { host.destroy(a); host.destroy(b); }
reject(()=>host.run(a,1), 'stale-handle-rejected');
const replacement=host.createSession(elf);
try { finish(host,replacement,43,'agentvm-real-elf-pass\n'); } finally { host.destroy(replacement); }
check(host.sessionCount()===0, 'error-recovery-cleanup');
const transfer=await createPortableRestart({wasmBytes:bytes,elfBytes:elf});
const restored=await restorePortableRestart({wasmBytes:bytes,elfBytes:elf,restartBytes:transfer.restartBytes,expected:transfer.source});
check(restored.exit===43 && restored.restoredExitSteps===transfer.source.sourceExitSteps, 'fresh-instance-restart-and-replay');
const reader=await read(`${fixtureDir}/workspace-reader.elf`);
const snapshot=await createPortableAgentSnapshot({wasmBytes:bytes,elfBytes:reader,workspaceContent:'agentvm workspace value=421\n'});
const recovered=await restorePortableAgentSnapshot({wasmBytes:bytes,elfBytes:reader,...snapshot,expected:snapshot.source});
check(recovered.stdout==='agentvm workspace value=421\n', 'workspace-snapshot-fresh-instance');
const random=await read(`${fixtureDir}/getrandom.elf`), before=host.entropyAvailable();
const h=host.createSession(random);
try { finish(host,h,111,''); } finally { host.destroy(h); }
check(host.entropyAvailable()===before,'ungranted-time-random-does-not-consume-entropy');
const granted=host.createSessionWithArgv(random,['getrandom']);
let entropy_exit;
try { for(let i=0;i<100;i++){if(host.run(granted,1000)===2)break;} entropy_exit=host.exitCode(granted); } finally { host.destroy(granted); }
const entropy_after=host.entropyAvailable();
if(entropy_exit!==0 || entropy_after!==before-16) failures.push({name:'explicit-entropy-consumption',exit:entropy_exit,before,after:entropy_after,expected_exit:0,expected_consumed:16});
else checks.push('explicit-entropy-consumption');
const {host:short} = await AgentVmWasmHost.instantiate(bytes);
const limited=short.createSession(await read(`${fixtureDir}/alu-loop.elf`), 10);
try { reject(()=>short.run(limited,1000), 'instruction-budget-enforced'); } finally { short.destroy(limited); }
check(short.sessionCount()===0 && host.sessionCount()===0, 'all-session-cleanup');
const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
console.log(JSON.stringify({ok:failures.length===0,schema:'agentvm.quality/v1',runtime:globalThis.Deno?`deno-${Deno.version.deno}`:globalThis.Bun?`bun-${Bun.version}`:`node-${process.versions.node}`,core_sha256:sha256,core_bytes:bytes.length,checks,failures,session_count:0},null,2));
if(failures.length){if(globalThis.Deno)Deno.exit(1);else process.exitCode=1;}
