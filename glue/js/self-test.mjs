import { AgentVmWasmHost } from "./host.mjs";

const STATUS_READY = 1;
const STATUS_EXITED = 2;
const EXPECTED_STDOUT = "agentvm-real-elf-pass\n";

function args() {
  if (globalThis.Deno?.args) return Deno.args;
  if (globalThis.process?.argv) return process.argv.slice(2);
  throw new Error("unable to discover runtime arguments");
}

async function readBytes(path) {
  if (globalThis.Deno?.readFile) return await Deno.readFile(path);
  if (globalThis.Bun?.file) return new Uint8Array(await Bun.file(path).arrayBuffer());
  const fs = await import("node:fs/promises");
  return new Uint8Array(await fs.readFile(path));
}

function runtime() {
  if (globalThis.Deno?.version?.deno) return `deno-${Deno.version.deno}`;
  if (globalThis.Bun?.version) return `bun-${Bun.version}`;
  if (globalThis.process?.versions?.node) return `node-${process.versions.node}`;
  return "unknown";
}

const [wasmPath, elfPath] = args();
if (!wasmPath || !elfPath) {
  throw new Error("usage: <runtime> glue/js/self-test.mjs <agentvm-core.wasm> <exit43.elf>");
}

const wasmBytes = await readBytes(wasmPath);
const elfBytes = await readBytes(elfPath);
const module = await WebAssembly.compile(wasmBytes);
const imports = WebAssembly.Module.imports(module);
if (imports.length !== 0) throw new Error(`expected zero imports, got ${imports.length}`);
const { host } = await AgentVmWasmHost.instantiateModule(module);
if (host.abiVersion() !== 5) throw new Error(`unexpected ABI ${host.abiVersion()}`);
const packed = host.exports.agentvm_wasm_directblock_smoke();
if ((packed & 0xff) !== 43 || (packed >>> 8) !== 7) {
  throw new Error(`embedded smoke mismatch: ${packed}`);
}

const handle = host.createSession(elfBytes, 100_000);
try {
  let status = STATUS_READY;
  let slices = 0;
  while (status !== STATUS_EXITED) {
    status = host.run(handle, 1);
    slices += 1;
    if (status !== STATUS_READY && status !== STATUS_EXITED) {
      throw new Error(`unexpected status ${status}`);
    }
    if (slices > 32) throw new Error("real ELF did not exit within 32 slices");
  }
  const stdout = new TextDecoder().decode(host.stdout(handle));
  const stderr = new TextDecoder().decode(host.stderr(handle));
  if (host.exitCode(handle) !== 43 || stdout !== EXPECTED_STDOUT || stderr !== "") {
    throw new Error(`real ELF mismatch exit=${host.exitCode(handle)} stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`);
  }
  console.log(JSON.stringify({
    ok: true,
    runtime: runtime(),
    abi: 5,
    imports: 0,
    wasm_bytes: wasmBytes.byteLength,
    elf_bytes: elfBytes.byteLength,
    exit: 43,
    steps: Number(host.steps(handle)),
    slices,
  }, null, 2));
} finally {
  host.destroy(handle);
  if (host.sessionCount() !== 0) throw new Error("session leak after self-test");
}
