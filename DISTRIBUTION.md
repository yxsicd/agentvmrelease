# Repository and jsDelivr distribution

Each channel manifest stays at channels/dev.json, channels/main.json or
channels/prod.json. Its core.repository_path names the only current Wasm in
that channel directory. distribution.host and distribution.fixture carry
path, SHA-256 and bytes in the same commit; core carries ABI5/imports0 and
SHA/bytes, while existing host_packages bind the immutable native packages.
No private Core source is published.

## Resolve an immutable cohort

Use GitHub GET /repos/yxsicd/agentvmrelease/commits/main to discover its full
40-hex commit (no-store). Fetch the selected manifest from:

```text
https://cdn.jsdelivr.net/gh/yxsicd/agentvmrelease@<commit>/channels/prod.json
```

Then fetch every referenced repository asset from that SAME commit, e.g.:

```text
https://cdn.jsdelivr.net/gh/yxsicd/agentvmrelease@<commit>/channels/prod/agentvm-core.wasm
```

Save the resolved commit with the manifest. An explicitly supplied immutable
commit bypasses discovery and is preferred for deployed consumers. Do not use
@main/latest channel refs for payloads. CDN caching can serve an older discovered
commit, but cannot mix its manifest and bytes. Git commits cannot contain their
own SHA: the resolved manifest commit is an external cohort fence, not a
self-referential field or the private source revision. API limits/offline/CDN
errors fail explicitly; consumers may use an already verified pinned cohort,
never silently skip identity checks or fall back to another version.

```js
import {resolveChannel, downloadVerified} from './glue/js/distribution.mjs';
const selected = await resolveChannel('prod', {revision: PUBLIC_COMMIT, signal});
const core = await downloadVerified(selected.coreUrl, selected.manifest.core, {signal});
const host = await downloadVerified(selected.hostUrl, selected.manifest.distribution.host, {signal});
const elf = await downloadVerified(selected.fixtureUrl, selected.manifest.distribution.fixture, {signal});
// Instantiate only after all three identities are verified; keep execution
// budgets, cancellation and finally/destroy in the consumer.
```

The helpers are acquisition utilities for browser/Node/Bun/Deno. No Wasm is
embedded in consumer code. Network permissions in a browser apply to Host
acquisition, not arbitrary Guest networking. CORS is independently verified
by scripts/verify-cdn.mjs (anonymous *, immutable URLs, exact download bytes,
ABI/imports, exit43/exact stdout/empty stderr/session cleanup). It is not a
browser user-journey test.

## Refresh a channel

Keep existing private-source, public qualification and promotion gates.
Distribution does not rebuild Core, change channel eligibility or promote DEV
to MAIN/PROD. After the selected release is qualified:

1. Update channel identity/qualification metadata and Host/fixture SHA/bytes.
2. Run node scripts/sync-channel-core.mjs dev (or explicitly main/prod).
   It downloads the manifest's immutable Release asset, validates SHA/size/
   ABI/imports before replacing the fixed current path. All selected inputs
   are verified before replacement; interrupted local writes must be reviewed.
3. Run node scripts/verify-repository-distribution.mjs, acquisition negative
   tests and exact source-free runtime gates. Commit manifests, current Core
   bytes and matching public Host/fixtures together, then push using
   git push origin HEAD:refs/heads/main (the repository also has a main tag;
   the short main ref is ambiguous).
4. Run node scripts/verify-cdn.mjs <public-commit> <receipt.json>. Preserve
   failure receipts; CDN propagation failure is not a publication PASS.

The source-free Node/Bun/Deno and Wasmi/Wasmtime matrix uses the checked-out
repository Core identity. Existing native packages still undergo digest and
relocation checks. The independent CDN workflow verifies all three channels
on push, manually and daily. Old binaries are retained in Git history and
immutable Release assets, not extra versioned Wasm files in the current tree.

## Current G6 distribution (2026-10-07 UTC/10-08 MSK)

DEV/MAIN/PROD contain the same qualified Core1922957B/SHA
dcf384f26ea9ad9cdeabda248b1f3e390505ff57330143b665f9636b2bfa42dd,
ABI5/imports0. Stable/latest Release is prod-20261007-g6, same exact six
MAIN assets without rebuild; anonymous asset/internal package identities and
latest routing pass. Allchannel immutable70cd2d05 publication CDN passes;
final qualified-manifest94ca685b3dffd5f56ca45f42003dd63b1eb79f35 receipts independently
PASS in provenance/generation6-prod-cdn-qualified.json and generation6-prod-
cdn-action.json (Action37692824051). Resolve a full public Git commit and keep all payloads on it.
Historical G3/G5 immutable rollback assets remain available.

## Verified initial repository publication (2026-10-03)

Immutable asset/manifest commit: 7203d65fa688964ba40585e464ceb3fbf508f9cf.
All three existing qualified generation3 channels contain original bytes,
1704601B, SHA f6da81a808447212f0dd607eca94126b36eb7119055842320a833c5b2045f20b.
No rebuild/promotion/Core capability change. Exact three-channel HTTP200,
anonymous CORS*, digest/size/ABI5/imports0, real ELF exit43/stdout/cleanup
receipt is provenance/repository-cdn-20261003.json. Local Node26.5.1,
Bun1.3.14 and Deno2.9.4 bounded ELF tests also pass; acquisition/receipt-policy
19 tests pass. An initial short-ref git push failed before publication;
explicit HEAD:refs/heads/main succeeded. CDN verification uses downloaded
bytes, not a local-byte substitute. It does not establish a browser journey,
new networking compatibility or a new performance baseline.

Initial CDN Action37140729925 failed to write/upload its receipt on a fresh
runner (target directory absent); that run does NOT qualify CDN acceptance.
Failure is retained in provenance/repository-cdn-initial-ci-failure-20261003.json.
The corrected dirname/resolve output path passes a fresh nested-directory
real CDN rerun in provenance/repository-cdn-fresh-output-20261003.json.
Independent CI reruns retain their own workflow result; a local PASS never
rewrites the failed run into PASS.

Windows source-free job111255598399/run37141031266 rejected the public Host
identity at checkout. A CRLF-default isolated checkout reproduces the exact
error:837 CRLF pairs add837B to host.mjs, changing25194B to26031B and its hash.
Explicit LF attributes for public text and binary attributes for Wasm/ELF fix
the checkout projection without changing Host/Core content or relaxing digest
checks. test-checkout-identity.mjs verifies all three cohorts under CRLF-default
Git configuration in every runtime/native lane. Keep the original failure and
wait for independent Windows CI before claiming its gate PASS.

Performance receipt admission also checks JS p95 against its actual raw samples,
integer bounded sample counts and positive measured linear memory. Native v1
receipts expose summaries only: their counts and instantiate/create/run/total
p95 are checked, but raw percentile recomputation is not claimed. Six malformed
mutations that previously passed are now rejected; the same seven real CI lanes
remain admitted locally. Evidence: provenance/receipt-policy-consistency-20261003.json.
This strengthens evidence quality without changing Core, benchmark methodology
or performance ceilings; shared-runner measurements are not a speedup claim.
