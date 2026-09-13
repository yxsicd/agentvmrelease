# Release channels

## dev — generation 2

Generation 2 is the first `dev` generation produced under the canonical
single-main publication rule. Private AgentVM source authority is clean pushed
`main@e1683ef606ea5ccadb3390f9ab8568b7b20c6271`; the resulting zero-import ABI-v5
Core is 903,550 bytes at SHA-256
`a6a9bcad38ae88cc9f845483dd59eec585d1af1d492ca4b8b871c35f21a6bf97`.

Private qualification passed the five Host tests and revalidated the exact
digest as the accepted whole-tool baseline at 3,261,655 guest steps / 537 run
calls for deterministic 1 MiB ripgrep. Public source-free qualification and
cross-platform Host packaging are intentionally reset to pending whenever the
`dev` Core digest changes. Old native Host packages must be removed before a new
generation is published so one release can never mix package generations.

Generation 1 is superseded because it was built before the clean-main-only
release-source rule was established. Its history remains below for provenance.

## dev — generation 1

The first public `dev` core is a clean rebuild of private semantic authority
`d8e4d986a6622ce978a0a7749c3e50a75cbb5e59` using the current pinned local
toolchain. It is ABI v5, zero-import, and intentionally treated as a **new
artifact generation** because its SHA-256 is not byte-identical to the
historical performance-qualified Host produced from the same source authority.

Historical performance authority remains the 903,774-byte artifact at
`778495b1106e3fbddbfcb586e98cb07658f2d5c2fd2e055e1f4ef6500e377096`.
That performance claim is not inherited by a rebuild with another digest.

Public source-free qualification is allowed to prove semantic portability of
the new `dev` bytes. Promotion to `main` additionally requires controlled
performance qualification of the exact `dev` digest.

## main

Unpublished until an exact `dev` artifact set passes the full admission gate.

## prod

Unpublished until an exact `main` artifact set passes soak/regression gates.
