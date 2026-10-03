import {spawnSync} from 'node:child_process';
import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [binary,core,dir='fixtures']=process.argv.slice(2);
const failures=[],results={};
const invoke=args=>{const r=spawnSync(binary,args,{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,windowsHide:true});if(r.error||r.signal)throw Error(`bounded native run: ${r.error??r.signal}`);return r;};
for(const engine of ['wasmi','wasmtime']){
  const gate=invoke([engine,'run',core,`${dir}/exit43.elf`]);
  if(gate.status!==43||gate.stdout!=='agentvm-real-elf-pass\n'||gate.stderr!=='')failures.push({engine,name:'exact-exit43',status:gate.status,stdout:gate.stdout,stderr:gate.stderr});
  const invalid=invoke([engine,'run',core,`${dir}/alu-loop.S`]);
  if(invalid.status===0||invalid.status===43)failures.push({engine,name:'invalid-ELF-not-rejected'});
  const entropy=invoke([engine,'run',core,`${dir}/getrandom.elf`]);
  if(entropy.status!==0||entropy.stdout!==''||entropy.stderr!=='')failures.push({engine,name:'getrandom',status:entropy.status,stdout:entropy.stdout,stderr:entropy.stderr});
  const bench=invoke([engine,'bench',core,'9','alu',`${dir}/alu-loop.elf`]);
  if(bench.status!==0)throw Error(`${engine} benchmark failed: ${bench.stderr}`);
  results[engine]=JSON.parse(bench.stdout);
  if(results[engine].results.alu.steps!==30013||results[engine].abi!==5||results[engine].imports!==0)throw Error('native benchmark identity drift');
  const recovery=invoke([engine,'run',core,`${dir}/exit43.elf`]);
  if(recovery.status!==43||recovery.stdout!=='agentvm-real-elf-pass\n'||recovery.stderr!=='')failures.push({engine,name:'fresh-process-error-recovery'});
}
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
console.log(JSON.stringify({ok:failures.length===0,schema:'agentvm.native-quality/v1',platform:process.platform,arch:process.arch,core_sha256:hash(core),fixture_sha256:hash(`${dir}/alu-loop.elf`),core_bytes:statSync(core).size,native_host_bytes:statSync(binary).size,native_host_sha256:hash(binary),results,failures,scope:'public CLI correctness and resident ALU benchmarks; no native snapshot/peak-RSS claim'},null,2));
if(failures.length)process.exitCode=1;
