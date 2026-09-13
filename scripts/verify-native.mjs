import { spawnSync } from "node:child_process";

const [binary, core, elf] = process.argv.slice(2);
if (!binary || !core || !elf) {
  throw new Error("usage: node scripts/verify-native.mjs <native-host> <agentvm-core.wasm> <exit43.elf>");
}

const results = [];
for (const engine of ["wasmi", "wasmtime"]) {
  const run = spawnSync(binary, [engine, "run", core, elf], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (run.error) throw run.error;
  if (run.status !== 43) {
    throw new Error(`${engine} guest exit mismatch: ${run.status}; stderr=${JSON.stringify(run.stderr)}`);
  }
  if (run.stdout !== "agentvm-real-elf-pass\n") {
    throw new Error(`${engine} stdout mismatch: ${JSON.stringify(run.stdout)}`);
  }
  if (run.stderr !== "") {
    throw new Error(`${engine} stderr mismatch: ${JSON.stringify(run.stderr)}`);
  }
  results.push({ engine, exit: run.status, stdout: run.stdout.trim(), stderr_bytes: 0 });
}

console.log(JSON.stringify({
  ok: true,
  platform: process.platform,
  arch: process.arch,
  binary,
  core,
  results,
}, null, 2));
