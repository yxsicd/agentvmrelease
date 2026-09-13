# Release channels

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
