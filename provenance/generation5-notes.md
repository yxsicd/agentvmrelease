# G5 DEV explicit workspace preview

Core was built from clean pushed private main a334a47839d1a71d2e4ab2be138016bead137332
with explicit-session-capabilities and agentvm-usermode/abi-workspace-mutate.
Build30.04s,61 warnings,1757119B,SHA854428a780fe442f3fa000de710ef6225993330250106888393e16831beb88b0.
ABI5/imports0. Existing constructors retain their grants. No semantic Core
implementation, Host filesystem permissions or network grants changed.

Private original Alpine static BusyBox shell, pinned SHA999cb969d09093a71716cfc747bb53cdada3f332c05eb5046c56e0f66a4d6d22,
passed Node26.5.1/Bun1.3.14/Deno2.9.4: false1 then mkdir0, child-file pipeline
stdout6 newline, readback hello newline,697780steps,session0.
Observed linear memory11730944B is not process RSS or a performance promotion.
BusyBox is not redistributed here; public ELF is an independent tiny syscall
fixture with source. Alternative BusyBox startup166 and links/chmod/times
remain unsupported/unqualified. MAIN/PROD Core bytes remain G3.

DEV is now qualified: fresh source-free run37168130299 at
ef7a066ed2df0eaa5d0116e196fb578fe8a9f7d2 passed all seven lanes and aggregate.
All35 exact-digest receipts were independently admitted locally with no failures;
aggregate SHA6bfdf988062f23fd9cbb295cec5002565be556c7daaaf137288c6b7b3ff3be09.
Qualified immutable manifest commit c9cd98064f29c058e2fc7ae51441c838b7832e57:
local real CDN readback PASS for dev/main/prod, HTTP200/CORS*, exact digest,
ELF exit43/stdout/empty stderr/session0. Independent CDN Action37168560637
at that commit PASS. Initial local CDN invocation used a mistyped full revision,
got404 and is retained as INVALID input receipt, not a candidate runtime failure.
Four-platform package build/attachment37167832831 PASS; all release assets
anonymously downloaded and their SHA/size verified. MAIN/PROD unchanged.
Package build37167832831 produced all four exact G5 packages; platform hashes
recorded in DEV manifest. Bootstrap source-free
37167857254 ran before packages were available and failed package downloads;
this result is retained, never relabeled as PASS.
Anonymous Release download matched exact Core SHA/size and ELF exit43. Three
paired same-machine rg1MiB receipts passed: run ratios Node0.9918803,
Bun1.0001236,Deno1.0000102; no speedup claim. Default workspace grants stayed
unchanged. These narrow performance receipts do not independently promote.
Pending-stage CDN runs37167815708/37167857271 correctly rejected the
unqualified DEV manifest; no CDN PASS is inherited. Source-free37167815728
was superseded by the validation-test push: three JS lanes passed but native
lanes cancelled and aggregate FAIL. Fresh full matrix is still required.
Initial Release creation with a short target SHA returned HTTP422 before any
Release was created; retry used full40hex a810eca77408de6c6c871649ceccfadf3d734d4e.
Do not inherit G4 qualification or package hashes. Exact-digest controlled
performance promotion remains pending even after public matrix success.
