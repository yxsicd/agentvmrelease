export function validateReceipts(receipts, manifest) {
  const failures=[];
  const core=manifest.core;
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
      if(r.schema!=='agentvm.performance/v1'||r.steps!==30013||!Number.isFinite(r.linear_memory_bytes)||r.linear_memory_bytes>128*1024*1024)failures.push(`performance contract ${name}`);
      for(const field of ['instantiate','create','run'])if(r[field]?.n<7||!Array.isArray(r[field]?.samples_ms)||r[field].samples_ms.length!==r[field].n||r[field].samples_ms.some(v=>!Number.isFinite(v)||v<0)||!Number.isFinite(r[field]?.p95_ms)||r[field].p95_ms>5000)failures.push(`invalid/grossly slow ${name}/${field}`);
      if(!Number.isFinite(r.compile_ms)||r.compile_ms<0||r.compile_ms>120000)failures.push(`compile ceiling ${name}`);
    }else if(name.startsWith('quality-native-')){
      if(r.fixture_sha256!==fixtureSha)failures.push(`native fixture ${name}`);
      if(r.schema!=='agentvm.native-quality/v1'||!Array.isArray(r.failures)||r.failures.length)failures.push(`native contract ${name}`);
      for(const engine of ['wasmi','wasmtime']){
        const b=r.results?.[engine];
        if(b?.engine!==engine||b.abi!==5||b.imports!==0||b.wasm_bytes!==core?.bytes||b.results?.alu?.steps!==30013)failures.push(`engine contract ${name}/${engine}`);
        if(!Number.isFinite(b?.compile_first_ms)||b.compile_first_ms<0||b.compile_first_ms>120000||!(b?.instantiate?.n>=7))failures.push(`native setup ${name}/${engine}`);
        for(const field of ['create','run','total'])if(!(b?.results?.alu?.[field]?.n>=7)||!Number.isFinite(b?.results?.alu?.[field]?.p95_ms)||b.results.alu[field].p95_ms<0||b.results.alu[field].p95_ms>5000)failures.push(`native performance ${name}/${engine}/${field}`);
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
