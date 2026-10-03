// Controlled same-machine paired whole-tool gate; no private source is loaded.
import {AgentVmWasmHost} from '../glue/js/host.mjs';
const args=globalThis.Deno?.args??process.argv.slice(2);
const read=async p=>globalThis.Deno?Deno.readFile(p):new Uint8Array(await(await import('node:fs/promises')).readFile(p));
const [oldPath,newPath,elfPath]=args;
if(!elfPath)throw Error('usage: qualify-promotion.mjs <baseline-core> <candidate-core> <prebuilt-static-rg>');
const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');
const elf=await read(elfPath),input=new Uint8Array(1048576).fill(120);
// Short lines keep rg's bounded read requests within the unchanged1MiB ABI limit.
for(let i=63;i<input.length;i+=64)input[i]=10;
input.set(new TextEncoder().encode('needle one\nbeta needle two\n'));input[input.length-1]=10;
const expected='1:needle one\n2:beta needle two\n';
const lanes=[];
for(const path of [oldPath,newPath]){
  const bytes=await read(path),t=performance.now(),module=await WebAssembly.compile(bytes);
  lanes.push({bytes,sha256:await sha(bytes),module,compile_ms:performance.now()-t,samples:[]});
}
for(let i=0;i<10;i++)for(const lane of i%2?[lanes[1],lanes[0]]:lanes){
  const t0=performance.now(),{host}=await AgentVmWasmHost.instantiateModule(lane.module),t1=performance.now();
  const handle=host.createAgentSessionWithArgv(elf,['rg','--threads','1','-n','needle','/workspace/input.txt'],50000000);
  try{
    host.writeWorkspace(handle,'/workspace/input.txt',input);const t2=performance.now();
    let state=1,calls=0;while(state!==2){state=host.run(handle,10000);if(![1,2].includes(state)||++calls>5000||performance.now()-t2>10000)throw Error('bounded whole-tool run failed: '+host.lastError());}
    const t3=performance.now(),stdout=new TextDecoder().decode(host.stdout(handle));
    if(host.exitCode(handle)!==0||stdout!==expected||host.stderr(handle).length)throw Error('whole-tool semantic mismatch');
    if(i>=3)lane.samples.push({instantiate_ms:t1-t0,setup_ms:t2-t1,run_ms:t3-t2,total_ms:t3-t0,steps:Number(host.steps(handle)),calls,linear_memory_bytes:host.memory.buffer.byteLength,stdout,exit:0});
  }finally{host.destroy(handle);if(host.sessionCount()!==0)throw Error('session leak');}
}
const median=x=>[...x].sort((a,b)=>a-b)[Math.floor(x.length/2)];
const ratios={};for(const k of ['run_ms','total_ms'])ratios[k]=median(lanes[1].samples.map(s=>s[k]))/median(lanes[0].samples.map(s=>s[k]));
// Gross controlled regression guard, not a small-delta or native-speed claim.
const ok=Object.values(ratios).every(r=>r<=2)&&lanes.every(l=>l.samples.every(s=>s.total_ms<5000&&s.linear_memory_bytes<=128*1024*1024)&&new Set(l.samples.map(s=>s.steps)).size===1);
console.log(JSON.stringify({schema:'agentvm.promotion-performance/v1',ok,runtime:globalThis.Deno?`deno-${Deno.version.deno}`:globalThis.Bun?`bun-${Bun.version}`:`node-${process.versions.node}`,fixture_sha256:await sha(elf),input_sha256:await sha(input),input_bytes:input.length,warmups:3,iterations:7,alternating_order:true,limits:{median_ratio:2,total_ms:5000,linear_memory_bytes:134217728},ratios,lanes:lanes.map(({bytes,sha256,compile_ms,samples})=>({core_sha256:sha256,core_bytes:bytes.length,compile_ms,samples})),scope:'same-machine static rg 1MiB workspace, no Guest compilation; linear memory is not peak RSS; no full Agent/network performance claim'},null,2));
if(!ok)throw Error('promotion performance gate failed');
