import {AgentVmWasmHost} from './host.mjs';
const args=globalThis.Deno?.args??process.argv.slice(2);
const read=async p=>globalThis.Deno?Deno.readFile(p):new Uint8Array(await(await import('node:fs/promises')).readFile(p));
const [core,fixture='fixtures/alu-loop.elf',count='9']=args;
const n=Number(count); if(!Number.isInteger(n)||n<7||n>31)throw Error('samples must be 7..31');
const bytes=await read(core),elf=await read(fixture);
const compileStart=performance.now(),module=await WebAssembly.compile(bytes),compile_ms=performance.now()-compileStart;
const inst=[],create=[],run=[],steps=[];let linear_memory_bytes=0;
for(let i=0;i<n+3;i++){
  const t0=performance.now(),{host}=await AgentVmWasmHost.instantiateModule(module),t1=performance.now();
  const h=host.createSession(elf,100000),t2=performance.now();
  try{
    let state=1,calls=0;while(state!==2){state=host.run(h,1000);if(![1,2].includes(state)||++calls>100)throw Error('bounded run failed');}
    const t3=performance.now();
    if(host.exitCode(h)!==0||new TextDecoder().decode(host.stdout(h))!=='OK\n'||host.stderr(h).length)throw Error('benchmark semantic mismatch');
    if(i>=3){inst.push(t1-t0);create.push(t2-t1);run.push(t3-t2);steps.push(Number(host.steps(h)));}
    linear_memory_bytes=Math.max(linear_memory_bytes,host.memory.buffer.byteLength);
  }finally{host.destroy(h);if(host.sessionCount()!==0)throw Error('leak');}
}
if(new Set(steps).size!==1)throw Error('guest steps drift');
const stats=x=>{const a=[...x].sort((a,b)=>a-b);return{n:x.length,p50_ms:a[Math.floor(a.length/2)],p95_ms:a[Math.ceil(a.length*.95)-1],min_ms:a[0],max_ms:a.at(-1),samples_ms:x};};
const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(b=>b.toString(16).padStart(2,'0')).join('');
console.log(JSON.stringify({ok:true,schema:'agentvm.performance/v1',runtime:globalThis.Deno?`deno-${Deno.version.deno}`:globalThis.Bun?`bun-${Bun.version}`:`node-${process.versions.node}`,core_sha256:await sha(bytes),fixture_sha256:await sha(elf),core_bytes:bytes.length,compile_ms,instantiate:stats(inst),create:stats(create),run:stats(run),steps:steps[0],guest_steps_per_second:steps[0]/(stats(run).p50_ms/1000),linear_memory_bytes,process_memory:globalThis.Deno?Deno.memoryUsage():process.memoryUsage(),scope:'fresh-instance ALU; process-memory point sample not peak RSS; CI timing diagnostic, no cross-run speedup claim'},null,2));
