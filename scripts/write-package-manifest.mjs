import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const [platform, binaryPath, corePath, outputPath] = process.argv.slice(2);
if (!platform || !binaryPath || !corePath || !outputPath) {
  throw new Error("usage: node scripts/write-package-manifest.mjs <platform> <native-host> <core.wasm> <output.json>");
}

async function identity(path) {
  const bytes = await readFile(path);
  return {
    bytes: (await stat(path)).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

const manifest = {
  schema: "agentvm.host-artifact/v1",
  platform,
  core: {
    file: "agentvm-core.wasm",
    abi: 5,
    imports: 0,
    ...(await identity(corePath)),
  },
  native_host: {
    file: binaryPath.endsWith(".exe") ? "agentvm-native-host.exe" : "agentvm-native-host",
    engines: ["wasmi", "wasmtime"],
    ...(await identity(binaryPath)),
  },
  public_glue: {
    repository: process.env.GITHUB_REPOSITORY || "yxsicd/agentvmrelease",
    commit: process.env.GITHUB_SHA || null,
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
