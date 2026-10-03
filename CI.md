# Public source-free quality gates

No browser, private source checkout or private-source credentials are used.
Push/PR/manual source-free runs verify DEV; daily02:37UTC runs verify MAIN.
Manual channel selection supports published PROD. Node26.5.1, Bun1.3.14 and
Deno2.9.4 run on standard Ubuntu. Wasmi2.0.0 and Wasmtime49.0.0-rc.1 run on
Linuxx64/ARM64, macOSARM64 and Windowsx64 standard runners.

Functional gates cover ABI5/zero imports, exact ELF output/exit, bounded argv,
invalid ELF, stale handles, session isolation, failure recovery, instruction
budget, checkpoint/replay, fresh-instance restart, SnapshotWorkspace transfer,
explicit entropy and cleanup. Native lanes cover CLI output/exit, invalid ELF,
fresh-process recovery, entropy and deterministic arithmetic. Native snapshot
API coverage is not claimed by CLI tests. Browser/network/dynamic Alpine and
representative full applications remain outside these public ABI tests.

Base Session grants process only. Its getrandom guest deliberately exits111
without consuming entropy; argv Session grants time-random and consumes16
bytes/exits0. Initial testing incorrectly expected positive getrandom on base
Session; this INVALID fixture assumption is retained here, not a Core bug.

Performance fixture alu-loop.elf executes30,013 guest steps with exact OK
newline/exit0. All engines run3 warmups and9 measured iterations; native
instantiate has7 samples. Record compile, instantiate, create/run p50/p95,
Core/fixture/Host identity and size. JS also records linear-memory bytes and
process memory at one point, NOT peak RSS; native peak RSS is unmeasured.
JS uses fresh instances; native uses resident instances. Do not compare these
as identical end-to-end lanes or infer full-tool speed from this micro workload.

Aggregate verification downloads actual job receipts, rejects missing/duplicate,
wrong digest/runtime/fixture, stale output, session leaks and invalid sample
sets. Also verifies published archive/internal Core/Host/provenance and executes
relocated packages. Missing packages fail this full public admission gate.
Build-DEV packaging independently runs Node functional and both native engine
gates before attaching new packages; it does not automatically promote channels.

Conservative gross guardrails: Core<=8MiB, JS linear memory<=128MiB, p95
create/run<=5s and JS compile<=120s. These are hang/gross-regression ceilings,
not SLA/performance parity. Small cross-run timing changes on shared runners
are diagnostic; exact-digest controlled paired measurements remain necessary
for MAIN performance promotion. JSON artifacts include raw JS sample arrays.
Artifact retention is bounded14days, aggregate30days; standard public runner
execution is free, but storage and concurrency still have service limits.

Local checks:

```sh
node --test scripts/test-receipt-policy.mjs
node glue/js/quality-gate.mjs path/to/agentvm-core.wasm
node glue/js/benchmark.mjs path/to/agentvm-core.wasm
node scripts/verify-native-quality.mjs path/to/native-host path/to/core.wasm
```

Workload binaries are committed tiny test fixtures, not private Core source.
alu-loop.S can rebuild with LLVM AArch64 clang/static lld; no Guest heavy build.
Consumer skill describes current capability limits. Changing this skill does
not rewrite already-published generation-specific skill archives.

Current main branch has no required-status protection (read-only check404).
Actions report quality failures but do not enforce a repository merge policy.
Repository protection/promotion automation must be configured separately with
explicit authorization; do not describe an unprotected branch as merge-blocked.
