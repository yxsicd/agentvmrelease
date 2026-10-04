function validTiming(stat, requireSamples=false) {
  if(!Number.isInteger(stat?.n)||stat.n<7||stat.n>31||
    !Number.isFinite(stat.p95_ms)||stat.p95_ms<0||stat.p95_ms>5000)return false;
  if(!requireSamples)return true; // Native v1 publishes summaries, not raw samples.
  if(!Array.isArray(stat.samples_ms)||stat.samples_ms.length!==stat.n||
    stat.samples_ms.some(v=>!Number.isFinite(v)||v<0))return false;
  const sorted=[...stat.samples_ms].sort((a,b)=>a-b);
  return stat.p95_ms===sorted[Math.ceil(stat.n*.95)-1];
}

export function validateReceipts(receipts, manifest) {
  const failures=[];
  const core=manifest.core;
  if(manifest.capability_profile){
    for(const runtime of ['node','bun','deno']){
      const r=receipts[`explicit-${runtime}.json`];
      if(r?.passed!==true||r.cleanup_sessions!==0||r.core?.sha256!==core?.sha256||r.core?.bytes!==core?.bytes||
         r.abi!==5||r.imports!==0||!r.runtime?.startsWith(runtime+'-')||r.cases?.length!==5||r.rejected?.length!==3||
         !['legacy-default','explicit-off','explicit-on','parent-denial','outside-denial'].every((name,i)=>r.cases?.[i]?.name===name&&r.cases[i].return===[-1,-1,0,-13,-2][i]&&r.cases[i].steps===18&&r.cases[i].guest_exit===1&&r.cases[i].stderr==='')||
         r.cases?.[2]?.child_write!==true||r.cases?.[2]?.replay_return!==0||r.cases?.[2]?.replay_steps!==18)
        failures.push(`explicit workspace contract ${runtime}`);
    }
  }
  const fixtureSha='3f26f9e1832b8b63955069d1bba972eee357b47114ec4cf20106fb3370f5b160';
  if(!core||core.abi!==5||core.imports!==0||core.bytes>8*1024*1024)failures.push('invalid Core contract/8MiB ceiling');
  const expected=[...['node','bun','deno'].flatMap(r=>[`quality-${r}.json`,`performance-${r}.json`]),...['linux-x64','linux-arm64','macos-arm64','windows-x64'].map(p=>`quality-native-${p}.json`)];
  for(const name of expected){
    const r=receipts[name];
    if(!r){failures.push(`missing ${name}`);continue;}
    if(r.ok!==true)failures.push(`failed ${name}`);
    if(r.core_sha256!==core?.sha256||r.core_bytes!==core?.bytes)failures.push(`wrong Core ${name}`);
    if(name.startsWith('performance-')){
      if(r.fixture_sha256!==fixtureSha||!r.runtime?.startsWith(name.slice(12,-5)+'-'))failures.push(`fixture/runtime ${name}`);
      if(r.schema!=='agentvm.performance/v1'||r.steps!==30013||!Number.isInteger(r.linear_memory_bytes)||r.linear_memory_bytes<=0||r.linear_memory_bytes>128*1024*1024)failures.push(`performance contract ${name}`);
      for(const field of ['instantiate','create','run'])if(!validTiming(r[field],true))failures.push(`invalid/grossly slow ${name}/${field}`);
      if(!Number.isFinite(r.compile_ms)||r.compile_ms<0||r.compile_ms>120000)failures.push(`compile ceiling ${name}`);
    }else if(name.startsWith('quality-native-')){
      if(r.fixture_sha256!==fixtureSha)failures.push(`native fixture ${name}`);
      if(r.schema!=='agentvm.native-quality/v1'||!Array.isArray(r.failures)||r.failures.length)failures.push(`native contract ${name}`);
      for(const engine of ['wasmi','wasmtime']){
        const b=r.results?.[engine];
        if(b?.engine!==engine||b.abi!==5||b.imports!==0||b.wasm_bytes!==core?.bytes||b.results?.alu?.steps!==30013)failures.push(`engine contract ${name}/${engine}`);
        if(!Number.isFinite(b?.compile_first_ms)||b.compile_first_ms<0||b.compile_first_ms>120000||!validTiming(b?.instantiate))failures.push(`native setup ${name}/${engine}`);
        for(const field of ['create','run','total'])if(!validTiming(b?.results?.alu?.[field]))failures.push(`native performance ${name}/${engine}/${field}`);
      }
    }else if(r.schema!=='agentvm.quality/v1'||!r.runtime?.startsWith(name.slice(8,-5)+'-')||r.session_count!==0||!Array.isArray(r.checks)||!r.checks.includes('fresh-instance-restart-and-replay')||!r.checks.includes('workspace-snapshot-fresh-instance')||!Array.isArray(r.failures)||r.failures.length)failures.push(`functional contract ${name}`);
  }
  for(const platform of ['linux-x64','linux-arm64','macos-arm64','windows-x64']){
    const pkg=receipts[`package-${platform}.json`],run=receipts[`relocated-${platform}.json`];
    const expectedPackage=manifest.host_packages?.find(p=>p.asset===`agentvm-host-${platform}.tar.gz`);
    if(pkg?.ok!==true||pkg.platform!==platform||pkg.sha256!==expectedPackage?.sha256||pkg.bytes!==expectedPackage?.bytes||pkg.internal_manifest?.core?.sha256!==core?.sha256)failures.push(`published package ${platform}`);
    if(run?.ok!==true||run.results?.length!==2||!['wasmi','wasmtime'].every(e=>run.results.some(r=>r.engine===e&&r.exit===43&&r.stdout==='agentvm-real-elf-pass'&&r.stderr_bytes===0)))failures.push(`relocated execution ${platform}`);
  }
  return failures;
}
