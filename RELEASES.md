# Release channels

## dev — generation4 candidate (2026-10-03)

Clean pushed private main a9808ccfd3494cd74b66942708a9add22b38ec06,
Core1727654B/SHA2ae5b4e532d289555b8306a0ac56f9ba4560cafa1e536284c9fa0af343aae698,
ABI5/imports0. Optional generic stream bridge and public peripheral FetchBridge
support JSON POST, awaited streaming and BYOB with separate Host quota/window.
Private actual browser10MiB byte checking, partial cancel/same-Host recovery,
CORS/JSON preflight and response edges have receipts. Public adapter10 unit
tests and exact Core static/quality tests pass locally. Native-package build
and fresh public multi-platform verification are PENDING; no inherited G3 PASS.
MAIN/PROD generation3 and rollback assets are unchanged. No transparent sockets,
auth headers, SSE, file durability or constant browser-RSS claim.

## dev — generation 3 (2026-10-03)

Clean pushed private main df6676eb produces ABI5 import-free Core1704601B,
SHA256 f6da81a808447212f0dd607eca94126b36eb7119055842320a833c5b2045f20b.
Immutable release tag dev-20261003-g3 is the DEV manifest's download target;
old dev/main generation2 assets remain available and are not mixed with it.
Local Host tests6/6 and Node/Bun/Deno/Wasmi/Wasmtime real exit43 gates pass.
Public source-free run37117072016 passed all JS and four-platform native gates.
Package run37117071978 built/verified4/4 packages but attachment failed because
publish job lacked checkout. Exact CI artifacts were internally verified and
manually uploaded without rebuilding; the failure is retained in provenance.
All four packages are bound to this Core and public glue4b33199. This larger
Core does not inherit generation2 performance admission; the independent
generation3 promotion qualification is recorded below.
Public consumer skill is skills/agentvm-wasm/SKILL.md. Native Alpine network
receipts do not imply those bindings exist in this public Wasm adapter.

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

Generation3 published at main-20261003-g3, with exact DEV Core, four native
packages and consumer skill bytes. Controlled same-machine alternating Node,
Bun and Deno runs qualify prebuilt ripgrep over1MiB short-line workspace:
3 warmups and7 measured iterations per artifact/runtime, exact output/exit and
cleanup, no Guest compilation. Candidate run median is28-52% slower than
generation2 (about30-34ms), not parity or speedup. It passes the explicitly
recorded gross2x/5s/128MiB guardrails; Wasm linear memory about15MB is not RSS.
Core1704601B is~89% larger. Full Agent/network performance remains unqualified.

The same1MiB very-long-line input fails on generation2's bounded read but
passes on generation3: exact stdout, exit0, empty stderr and cleanup0.
Initial wrong import helper setup is INVALID fixture, separate from the real
baseline failure. Evidence: provenance/promotion-long-line-20261003.json.

Two fresh published MAIN full matrix regressions37120164805/37120492444
PASS: all seven JS/native lanes plus aggregate,32 actual receipts each.
This is short-term repeated regression admission, not overnight soak or
representative public Agent journey. Generation2 releases remain untouched.
Performance and exact reports are in provenance/promotion-performance-20261003.json
and provenance/main-g3-{first,second}-20261003.json.

## prod

Generation3 published at prod-20261003-g3, byte-for-byte from qualified MAIN;
no Core/package/skill rebuild. Stable release remains limited to documented
ABI5 static execution capabilities, not native Alpine network bindings,
dynamic distro tools, streaming stdin or full application performance.
PROD-address full matrix run37120834681 PASS: all seven JS/native lanes plus
aggregate,32 actual receipts. Exact report: provenance/prod-g3-final-20261003.json.
Anonymous Core download hash/Node execution and all published asset SHA checks
PASS. Metadata qualification was finalized after CI; Core/package/skill bytes
were not changed. Both MAIN and PROD are publicly downloadable.
