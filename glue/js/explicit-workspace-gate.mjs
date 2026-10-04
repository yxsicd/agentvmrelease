import {AgentVmWasmHost} from './host.mjs';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
const args = globalThis.Deno?.args ?? process.argv.slice(2);
const [corePath, coreSha, elfPath, receiptPath] = args;
if (!receiptPath) throw Error('usage: <experimental-Core> <SHA256> <pinned-probe.elf> <receipt.json>');
const sha = b => createHash('sha256').update(b).digest('hex');
const core = await readFile(corePath), original = await readFile(elfPath);
const receipt = {schema:'agentvm.wasm-explicit-workspace/v1',
  runtime:globalThis.Deno?`deno-${Deno.version.deno}`:globalThis.Bun?`bun-${Bun.version}`:`node-${process.versions.node}`,
  core:{bytes:core.length,sha256:sha(core)},driver_sha256:sha(await readFile(new URL(import.meta.url))),
  host_sha256:sha(await readFile(new URL('./host.mjs',import.meta.url))),
  cases:[],passed:false,scope:'Experimental explicit SnapshotWorkspace grant, not default/public profile or Alpine application admission'};
const ensure = (ok,message) => {if(!ok)throw Error(message);};
let host;
try {
  ensure(sha(core)===coreSha,'Core identity mismatch');
  ensure(original.length===688&&sha(original)==='eb4bb4dc774c3ae831a3a5e3adb5c47d074aed0d4c1754a4ea66e18777cda4e4','fixture mismatch');
  ({host}=await AgentVmWasmHost.instantiate(core));
  receipt.abi=host.abiVersion();receipt.imports=WebAssembly.Module.imports(host.module).length;
  ensure(receipt.abi===5&&receipt.imports===0,'ABI mismatch');
  const pathOffset=Buffer.from(original).indexOf(Buffer.from('/workspace/notes\0'));
  ensure(pathOffset>=0,'fixture path missing');
  for(const [name,path,caps,expected] of [
    ['legacy-default','/workspace/notes',null,-1],
    ['explicit-off','/workspace/notes','process,workspace',-1],
    ['explicit-on','/workspace/notes','process,workspace,workspace-mutate',0],
    ['parent-denial','../escape','process,workspace,workspace-mutate',-13],
    ['outside-denial','/etc/escape','process,workspace,workspace-mutate',-2],
  ]) {
    const elf=Buffer.from(original);elf.fill(0,pathOffset,pathOffset+16);Buffer.from(path).copy(elf,pathOffset);
    const h=caps===null?host.createAgentSessionWithArgv(elf,['probe'],1000):host.createAgentSessionWithCapabilities(elf,['probe'],caps,1000);
    try {
      const snapshot=name==='explicit-on'?host.exportAgentSnapshot(h):null;
      const start=performance.now();let state=1,calls=0;
      while(state===1&&calls<100){state=host.run(h,1);calls++;}
      const out=host.stdout(h),err=new TextDecoder().decode(host.stderr(h));
      const value=out.length===8?Number(new DataView(out.buffer,out.byteOffset,8).getBigInt64(0,true)):null;
      const c={name,path,capabilities:caps,guest_sha256:sha(elf),state,guest_exit:host.exitCode(h),return:value,
        stdout_hex:Buffer.from(out).toString('hex'),stderr:err,steps:Number(host.steps(h)),calls,
        wall_ms:performance.now()-start,linear_memory_bytes:host.memory.buffer.byteLength};
      ensure(state===2&&c.guest_exit===1&&value===expected&&c.steps===18&&err==='','exact syscall mismatch');
      if(name==='explicit-on') {
        host.writeWorkspace(h,'/workspace/notes/value',new TextEncoder().encode('created\n'));
        c.child_write=true;
        const restored=host.createAgentSessionFromSnapshot(elf,snapshot.restartBytes,snapshot.workspaceBytes);
        try {
          try{host.writeWorkspace(restored,'/workspace/notes/value',new Uint8Array([1]));throw Error('restore retained directory');}
          catch(error){ensure(String(error).includes('workspace path was not found'),'unexpected restore refusal');c.restore_write_error=String(error);}
          let replay=1,replayCalls=0;while(replay===1&&replayCalls<100){replay=host.run(restored,1);replayCalls++;}
          const replayOut=host.stdout(restored);
          ensure(replay===2&&Buffer.from(replayOut).toString('hex')==='0000000000000000'&&host.exitCode(restored)===1,'restore replay failed');
          c.replay_return=0;c.replay_steps=Number(host.steps(restored));
        } finally {host.destroy(restored);}
      }
      receipt.cases.push(c);
    } finally {host.destroy(h);ensure(host.sessionCount()===0,'session leak');}
  }
  receipt.rejected=[];
  for(const [spec,expectedError] of [
    ['process','requires process and workspace'],
    ['process,workspace,unknown','unknown runtime capability: unknown'],
    ['process,workspace,network','abi-network was not compiled'],
  ]) {
    try{const h=host.createAgentSessionWithCapabilities(original,['probe'],spec,1000);host.destroy(h);throw Error('invalid capabilities admitted');}
    catch(error){ensure(String(error).includes(expectedError),'unexpected capability refusal');receipt.rejected.push({spec,error:String(error)});}
    ensure(host.sessionCount()===0,'rejected session leak');
  }
  receipt.passed=receipt.cases.length===5&&receipt.rejected.length===3;
} catch(error){receipt.error=String(error);}
finally {
  receipt.cleanup_sessions=host?.sessionCount()??null;receipt.passed&&=receipt.cleanup_sessions===0;
  await mkdir(dirname(receiptPath),{recursive:true});await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt,null,2));
}
if(!receipt.passed){if(globalThis.Deno)Deno.exit(1);else process.exitCode=1;}
