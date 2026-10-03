import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReceipts} from './receipt-policy.mjs';
const m={core:{abi:5,imports:0,bytes:1704601,sha256:'test-core'}};
const platforms=['linux-x64','linux-arm64','macos-arm64','windows-x64'];
m.host_packages=platforms.map(p=>({asset:`agentvm-host-${p}.tar.gz`,sha256:p,bytes:100}));
const stat={n:9,p95_ms:1,samples_ms:Array(9).fill(1)};
function good(){const r={};for(const runtime of ['node','bun','deno']){
  r[`quality-${runtime}.json`]={ok:true,schema:'agentvm.quality/v1',core_sha256:'test-core',core_bytes:1704601,session_count:0,checks:['fresh-instance-restart-and-replay','workspace-snapshot-fresh-instance'],failures:[]};
  r[`performance-${runtime}.json`]={ok:true,schema:'agentvm.performance/v1',core_sha256:'test-core',core_bytes:1704601,steps:30013,compile_ms:1,linear_memory_bytes:1638400,instantiate:structuredClone(stat),create:structuredClone(stat),run:structuredClone(stat)};
}for(const platform of ['linux-x64','linux-arm64','macos-arm64','windows-x64'])r[`quality-native-${platform}.json`]={ok:true,schema:'agentvm.native-quality/v1',core_sha256:'test-core',core_bytes:1704601,failures:[],results:Object.fromEntries(['wasmi','wasmtime'].map(engine=>[engine,{engine,abi:5,imports:0,wasm_bytes:1704601,results:{alu:{steps:30013,create:stat,run:stat,total:stat}}}]))};return r;}
function boundGood(){const r=good();for(const runtime of ['node','bun','deno']){r[`quality-${runtime}.json`].runtime=runtime+'-test';r[`performance-${runtime}.json`].runtime=runtime+'-test';}for(const v of Object.values(r))v.fixture_sha256='3f26f9e1832b8b63955069d1bba972eee357b47114ec4cf20106fb3370f5b160';for(const p of platforms){for(const engine of ['wasmi','wasmtime']){r[`quality-native-${p}.json`].results[engine].compile_first_ms=1;r[`quality-native-${p}.json`].results[engine].instantiate={n:7};}r[`package-${p}.json`]={ok:true,platform:p,sha256:p,bytes:100,internal_manifest:{core:{sha256:'test-core'}}};r[`relocated-${p}.json`]={ok:true,results:['wasmi','wasmtime'].map(engine=>({engine,exit:43,stdout:'agentvm-real-elf-pass',stderr_bytes:0}))};}return r;}
test('complete receipts admitted',()=>assert.deepEqual(validateReceipts(boundGood(),m),[]));
test('empty and missing rejected',()=>{assert.ok(validateReceipts({},m).length);const r=good();delete r['quality-node.json'];assert.ok(validateReceipts(r,m).length);});
for(const [name,mutate] of [
  ['failed functionality',r=>r['quality-node.json'].ok=false],
  ['wrong core',r=>r['quality-bun.json'].core_sha256='other'],
  ['session leak',r=>r['quality-deno.json'].session_count=1],
  ['missing recovery',r=>r['quality-node.json'].checks=[]],
  ['too few samples',r=>r['performance-node.json'].run.n=1],
  ['NaN clock',r=>r['performance-node.json'].compile_ms=NaN],
  ['gross slowdown',r=>r['performance-bun.json'].run.p95_ms=6000],
  ['linear memory ceiling',r=>r['performance-deno.json'].linear_memory_bytes=2**30],
  ['wrong guest steps',r=>r['performance-node.json'].steps=30014],
  ['native failed engine',r=>r['quality-native-linux-x64.json'].results.wasmi.abi=4],
  ['wrong fixture',r=>r['performance-node.json'].fixture_sha256='other'],
  ['wrong runtime',r=>r['quality-node.json'].runtime='bun-test'],
  ['package mismatch',r=>r['package-linux-x64.json'].sha256='other'],
  ['missing relocated engine',r=>r['relocated-windows-x64.json'].results.pop()],
])test(name,()=>{const r=boundGood();mutate(r);assert.ok(validateReceipts(r,m).length);});
