# AgentVM Native Host

This is public Host glue for the source-free `agentvm-core.wasm` product. It
contains no AgentVM core implementation source.

One executable supports two outer Wasm engines:

```sh
cargo build --release

target/release/agentvm-native-host wasmi run \
  /path/to/agentvm-core.wasm /path/to/guest.elf guest-argv0

target/release/agentvm-native-host wasmtime run \
  /path/to/agentvm-core.wasm /path/to/guest.elf guest-argv0
```

The `bench` subcommand is retained as a black-box qualification surface for
release CI. It consumes an explicit workload corpus whose expected stdout and
step counts are known by the harness; ordinary users should use `run`.

The Host rejects unexpected ABI versions and non-zero-import Core modules. The
same exact Core bytes should be used for Wasmi, Wasmtime, and JavaScript Host
qualification.
