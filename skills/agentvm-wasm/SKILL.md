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
For browser/CDN use the repository distribution instead: resolve the public
repository main to a 40-hex Git commit FIRST, then fetch channels/<channel>.json,
core.repository_path, distribution.host and distribution.fixture from that
SAME commit via https://cdn.jsdelivr.net/gh/yxsicd/agentvmrelease@<commit>/<path>.
Never fetch Wasm from @main/@dev/@prod or combine a moving manifest with a
different asset revision. A stale discovery result yields an older intact
cohort, not a mixed generation. To refresh, repeat discovery without cache.
The reusable glue/js/distribution.mjs resolveChannel/downloadVerified helpers
enforce pinned paths, bounded downloads, SHA/size and anonymous CORS-mode
acquisition; pass a caller AbortSignal for cancellation. They do not grant
network access to the Guest. Verify the Host and fixture identities as well
as Core before using them. Each channel has ONE current
channels/<channel>/agentvm-core.wasm; history uses immutable Git commit URLs.
See DISTRIBUTION.md for integration and release-refresh steps.
Keep the repository's .gitattributes when checking out on Windows. Exact
Host identities are Git/CDN LF bytes; do not normalize downloaded content or
change the manifest hash to accept a CRLF checkout. Public Wasm/ELF are binary.
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
