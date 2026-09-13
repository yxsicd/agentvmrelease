# Security and source boundary

The AgentVM Core source repository is private and is not a dependency of this
public repository or its GitHub Actions.

Public workflows must never receive a token, deploy key, GitHub App credential,
or other capability that can read the private AgentVM source repository. They
may consume only public release assets and the public Host glue committed here.

`agentvm-core.wasm` is executable product code. Consumers must verify its exact
size and SHA-256 against the selected channel manifest before execution.

The public Host glue and the binary Core have separate source/licensing
boundaries. Publication of this repository does not imply publication of the
AgentVM Core source.
