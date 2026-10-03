import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import {validateReceipts} from './receipt-policy.mjs';

const needs = JSON.parse(process.env.AGENTVM_CI_NEEDS || "{}");
const entries = Object.entries(needs).map(([job, value]) => ({
  job,
  result: value?.result ?? "missing",
}));
const failures = entries.filter(({ result }) => result !== "success");
if(entries.length!==2||!entries.some(e=>e.job==='javascript')||!entries.some(e=>e.job==='native'))failures.push({job:'required jobs',result:'missing'});
const manifest=JSON.parse(await readFile(`channels/${process.env.AGENTVM_CHANNEL||'dev'}.json`,'utf8'));
const receipts={};
async function collect(path){
  for(const entry of await readdir(path,{withFileTypes:true})){
    const p=`${path}/${entry.name}`;
    if(entry.isDirectory())await collect(p);
    else if(entry.name.endsWith('.json')){
      if(receipts[entry.name])throw Error(`duplicate receipt ${entry.name}`);
      receipts[entry.name]=JSON.parse(await readFile(p,'utf8'));
    }
  }
}
await collect('target/ci-input');
const receipt_failures=validateReceipts(receipts,manifest);
await mkdir("target/ci-aggregate", { recursive: true });
const report = {
  schema: "agentvm.public-verification/v1",
  repository: process.env.GITHUB_REPOSITORY || null,
  run_id: process.env.GITHUB_RUN_ID || null,
  commit: process.env.GITHUB_SHA || null,
  channel: process.env.AGENTVM_CHANNEL || "dev",
  jobs: entries,
  core:manifest.core,
  receipts,
  receipt_failures,
  ok: failures.length === 0 && receipt_failures.length===0,
};
await writeFile(
  "target/ci-aggregate/verification-report.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
const timingRows=Object.entries(receipts).filter(([n])=>n.startsWith('performance-')).map(([n,r])=>`| ${r.runtime} | ${r.compile_ms?.toFixed(3)} | ${r.instantiate?.p50_ms?.toFixed(3)} | ${r.run?.p50_ms?.toFixed(3)} | ${r.run?.p95_ms?.toFixed(3)} | ${r.linear_memory_bytes} |`);
if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,`# AgentVM public quality\n\nCore ${manifest.core?.sha256}, ${manifest.core?.bytes} bytes.\n\nResult: ${report.ok?'PASS':'FAIL'}\n\n${receipt_failures.map(f=>'- '+f).join('\n')}\n\n| JS runtime | compile ms | instantiate p50 ms | run p50 ms | run p95 ms | linear memory B |\n|---|---:|---:|---:|---:|---:|\n${timingRows.join('\n')}\n\nNative Wasmi/Wasmtime compile, instantiate and resident create/run distributions are in attached JSON. JS fresh-instance and native resident timings are different lanes.\n\nTiming is shared-runner diagnostic; no small-delta performance promotion.\n`);
if (!report.ok) process.exit(1);
