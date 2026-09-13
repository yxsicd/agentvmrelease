import { AgentVmWasmHost } from "./host.mjs";

const STATUS_READY = 1;
const STATUS_EXITED = 2;

function runtimeArgs() {
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

function writeStdout(bytes) {
  if (globalThis.Deno?.stdout?.writeSync) return Deno.stdout.writeSync(bytes);
  process.stdout.write(Buffer.from(bytes));
}

function writeStderr(bytes) {
  if (globalThis.Deno?.stderr?.writeSync) return Deno.stderr.writeSync(bytes);
  process.stderr.write(Buffer.from(bytes));
}

function setExit(code) {
  if (globalThis.Deno?.exit) Deno.exit(code);
  process.exitCode = code;
}

const input = runtimeArgs();
const separator = input.indexOf("--");
const positional = separator >= 0 ? input.slice(0, separator) : input;
const guestArgs = separator >= 0 ? input.slice(separator + 1) : [];
const [wasmPath, elfPath] = positional;
if (!wasmPath || !elfPath) {
  throw new Error("usage: <runtime> glue/js/run.mjs <agentvm-core.wasm> <guest.elf> [-- guest args...]");
}

const wasmBytes = await readBytes(wasmPath);
const elfBytes = await readBytes(elfPath);
const { host, imports } = await AgentVmWasmHost.instantiate(wasmBytes);
if (imports.length !== 0 || host.abiVersion() !== 5) {
  throw new Error(`AgentVM core contract mismatch abi=${host.abiVersion()} imports=${imports.length}`);
}
const argv = [guestArgs[0] || elfPath, ...guestArgs.slice(1)];
const handle = host.createSessionWithArgv(elfBytes, argv, 500_000_000);
try {
  let status = STATUS_READY;
  let calls = 0;
  while (status !== STATUS_EXITED) {
    status = host.run(handle, 10_000);
    calls += 1;
    if (status !== STATUS_READY && status !== STATUS_EXITED) {
      throw new Error(`unexpected AgentVM status ${status}`);
    }
    if (calls > 100_000) throw new Error("AgentVM run-call bound exceeded");
  }
  writeStdout(host.stdout(handle));
  writeStderr(host.stderr(handle));
  setExit(host.exitCode(handle));
} finally {
  host.destroy(handle);
}
