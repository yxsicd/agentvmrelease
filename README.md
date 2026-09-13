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

The first active generation is described in [`channels/dev.json`](channels/dev.json).
`main` and `prod` start unpublished and become valid only after their promotion
gates close.

## Public Host glue

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
