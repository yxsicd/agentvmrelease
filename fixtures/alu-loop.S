// Public bounded arithmetic workload: 10,000 iterations, exact exit0/OK.
.global _start
.section .text
_start:
    mov x9, #10000
    mov x10, #0
1:
    add x10, x10, #1
    subs x9, x9, #1
    b.ne 1b
    mov x11, #10000
    cmp x10, x11
    b.ne fail
    mov x0, #1
    adr x1, message
    mov x2, #3
    mov x8, #64
    svc #0
    mov x0, #0
    mov x8, #93
    svc #0
fail:
    mov x0, #111
    mov x8, #93
    svc #0
message:
    .ascii "OK\n"
