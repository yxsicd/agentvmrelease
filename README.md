# AgentVM Release

This repository is the public, source-free release and Host-integration surface
for AgentVM. The AgentVM execution core is built from a private source
repository and published here only as an exact `wasm32-unknown-unknown` binary.
The Host glue in this repository is intentionally public so the same Core Wasm
can be consumed, tested, and packaged across JavaScript and native Wasm engines.

## Source boundary

- **Private:** AgentVM DirectBlock/UserMode implementation, Linux syscall model,
  portable Region implementations, checkpoint/COW internals, performance
  optimizations, and the Rust source that produces `agentvm-core.wasm`.
- **Public:** the ABI-v5 Host glue, release manifests, test fixtures, integrity
  scripts, GitHub Actions, and native/JavaScript consumer packaging.
- **Canonical product identity:** the SHA-256 of `agentvm-core.wasm`. A source
  commit is provenance, not a substitute for the released bytes.

The current core is import-free and exports linear memory plus the AgentVM ABI
v5 byte/handle interface. Hosts own file acquisition, persistence, networking,
workers, and secure entropy acquisition; the core owns AArch64/Linux execution
and checkpointable guest state.

## Channels

AgentVM uses three moving release channels:

| channel | meaning | mutation policy |
| --- | --- | --- |
| `dev` | fast/commit build and public qualification | may be replaced frequently |
| `main` | release candidate / preview | promotion from an already-qualified `dev` artifact set only |
| `prod` | stable product | promotion from `main` only |

Promotion means **byte-for-byte promotion**. `main` and `prod` must not rebuild
the core or native packages. Every channel manifest records exact sizes and
SHA-256 identities.

Native package artifacts are deliberately channel-neutral, for example
`agentvm-host-linux-x64.tar.gz` and `agentvm-host-macos-arm64.tar.gz`. Their
contents carry an immutable `HOST-ARTIFACT.json` bound to the exact Core and
public-Glue commit. Only the release channel pointer/manifest changes during
promotion.

The newest DEV generation is described in [`channels/dev.json`](channels/dev.json).
Generation6 is qualified DEV: exact35 public receipts, four newly built platform
packages, anonymous artifact integrity and actual Chromium explicit-workspace
application checks. Its optional in-memory workspace grants remain explicit;
existing constructors keep their grants. The exact same Core/package/consumer
skill bytes advance to MAIN/PROD only after their separate admission gates.
MAIN now points to generation6 preview; two fresh MAIN35receipt regressions have passed. PROD publishes the same generation6 bytes as stable/latest; its fresh address-specific matrix is running. Download the selected manifest's exact
immutable generation URL and preserve its public commit. Old G5/G3 assets remain
available for rollback. This release qualifies bounded static AArch64 Linux
execution and documented optional in-memory workspace tasks; full Alpine,
_asyncio, native product packaging, unrestricted Guest networking, durable Host
filesystem and peak RSS remain unqualified. See RELEASES.md for exact receipts.

## Public Host glue

Browser-readable Core distribution now lives directly in this public tree:
`channels/dev/agentvm-core.wasm`, `channels/main/agentvm-core.wasm` and
`channels/prod/agentvm-core.wasm`. Each channel keeps one current file.
Resolve one immutable public commit, fetch its manifest and all assets through
jsDelivr using that SAME commit, and verify SHA/bytes/ABI/Host/fixture identities.
Never combine moving CDN refs. See [DISTRIBUTION.md](DISTRIBUTION.md).
Existing immutable GitHub Release assets and native package identities remain
unchanged; this is distribution-only, not a new Core or channel promotion.

The public consumer skill is [skills/agentvm-wasm/SKILL.md](skills/agentvm-wasm/SKILL.md).
It covers integrity-checked acquisition, bounded execution and the current
adapter limits; it does not expose private maintainer skills or source.

JavaScript:

```text
agentvm-core.wasm -> glue/js/host.mjs -> Node / Deno / Bun
```

Native validation/packaging:

```text
agentvm-core.wasm -> glue/rust/agentvm-native-host -> Wasmi / Wasmtime
```

The JavaScript adapter can execute ordinary static AArch64 Linux ELF guests:

```sh
node glue/js/run.mjs agentvm-core.wasm guest.elf -- guest-arg
deno run --allow-read glue/js/run.mjs agentvm-core.wasm guest.elf -- guest-arg
bun glue/js/run.mjs agentvm-core.wasm guest.elf -- guest-arg
```

The native Rust Host supports both outer engines:

```sh
agentvm-native-host wasmi run agentvm-core.wasm guest.elf guest-arg
agentvm-native-host wasmtime run agentvm-core.wasm guest.elf guest-arg
```

## Release philosophy

See [CI.md](CI.md) for the public Node/Bun/Deno, Wasmi/Wasmtime functional,
performance and published-package guardrails and their remaining boundaries.

The private AgentVM repository has one release source: a clean, validated,
pushed `main` with local `HEAD == origin/main`. Feature branches, research
branches, detached worktrees, and dirty working trees are never publication
sources. The private build emits one exact Core Wasm artifact; this public
repository consumes that byte identity only.

Private controlled machines decide semantic and micro-performance admission.
Public GitHub Actions independently verify the exact released bytes across
engines, operating systems, and architectures, and may build public Host
packages around those bytes. Shared GitHub runners are compatibility/correctness
evidence, not the authority for small performance deltas.

No public workflow has credentials capable of reading the private AgentVM
source repository.
