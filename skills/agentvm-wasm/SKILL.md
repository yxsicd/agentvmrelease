---
name: agentvm-wasm
description: Consume the public AgentVM Core Wasm release to execute bounded static AArch64 Linux ELF programs with Node, Bun, Deno or the public native Host. Use for artifact verification and ABI-v5 integration, not private Core development or unrestricted Alpine/network compatibility claims.
---

# AgentVM Wasm consumer

Use https://github.com/yxsicd/agentvmrelease as the source-free distribution.
Clone or use an existing clean checkout; read README.md and the selected
channels/dev.json, channels/main.json or channels/prod.json before downloading.
DEV is mutable preview, MAIN is qualified preview, PROD is stable only when
published. Pin the repository commit and save the channel manifest alongside
downloaded bytes. Never inherit qualification from a different Core digest.

Download the manifest's core.download to a task-local agentvm-core.wasm, then
verify it with `node scripts/verify-manifest.mjs <manifest> <core.wasm>`.
Reject size/hash mismatch; do not disable integrity checks. Native packages
must match that same channel's host_packages identities and internal
HOST-ARTIFACT.json Core identity. Never mix old packages with a newer Core.

Run the bounded fixture before a real task:

```sh
node glue/js/self-test.mjs agentvm-core.wasm fixtures/exit43.elf
bun glue/js/self-test.mjs agentvm-core.wasm fixtures/exit43.elf
deno run --allow-read glue/js/self-test.mjs agentvm-core.wasm fixtures/exit43.elf
```

Require ABI5, zero imports, guest exit43, exact agentvm-real-elf-pass newline,
empty stderr and zero sessions after destruction. Self-test process exit0
means gate success; the real run CLI propagates guest exit43 instead.
Use only the installed runtime; do not install all engines merely to run a task.

For an ordinary static AArch64 Linux ELF:

```sh
node glue/js/run.mjs agentvm-core.wasm guest.elf -- guest.elf arg1
```

Bun uses the same arguments; Deno uses `run --allow-read`. Grant only task
input reads, not --allow-all. Native: `agentvm-native-host wasmi run
agentvm-core.wasm guest.elf`, or select wasmtime explicitly.

For embedding use glue/js/host.mjs AgentVmWasmHost: instantiate exact bytes,
createSessionWithArgv, run bounded slices, read stdout/stderr/exit, always
destroy in finally. Hosts own byte acquisition and secure entropy; no imports
does not imply identical capability profiles: base createSession is process-only,
while createSessionWithArgv adds signals/time-random/events. Base createAgentSession
adds workspace; its argv variant additionally grants signals/time-random/events.
Test both granted success and ungranted rejection rather than broadening a
Session to make a fixture pass. See CI.md for public quality/performance gates.
Zero imports
does not grant arbitrary filesystem or network access. The current public
adapter is not the experimental native Alpine HostNetwork/VFS binding. Do not
claim dynamic distro tools, streaming stdin, TCP/UDP, browser persistence,
or native JIT support from the static fixture. Waiting-input states unsupported
by ABI5 fail explicitly rather than spin as runnable. Keep step/call budgets
and cancellation in the caller; never remove bounds to mask stalled progress.

Report selected channel/generation, exact Core SHA/bytes, runtime, stdout,
stderr, guest exit and cleanup separately. Startup time, process RSS, Wasm
linear memory and artifact size are distinct measurements. A fixture pass
does not prove representative application compatibility or performance.
