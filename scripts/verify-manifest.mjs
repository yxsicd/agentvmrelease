import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const [manifestPath, corePath] = process.argv.slice(2);
if (!manifestPath || !corePath) {
  throw new Error("usage: node scripts/verify-manifest.mjs <manifest.json> <agentvm-core.wasm>");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!manifest.core) throw new Error("selected channel is not published");
const bytes = await readFile(corePath);
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (bytes.byteLength !== manifest.core.bytes) {
  throw new Error(`core byte mismatch: ${bytes.byteLength} != ${manifest.core.bytes}`);
}
if (sha256 !== manifest.core.sha256) {
  throw new Error(`core SHA-256 mismatch: ${sha256} != ${manifest.core.sha256}`);
}
console.log(JSON.stringify({
  ok: true,
  channel: manifest.channel,
  generation: manifest.generation,
  bytes: bytes.byteLength,
  sha256,
  abi: manifest.core.abi,
  imports: manifest.core.imports,
}, null, 2));
