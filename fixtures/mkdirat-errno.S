// No libc or BusyBox startup: return the raw Linux mkdirat result on stdout.
.section .text
.global _start
_start:
    mov x0, #-100               // AT_FDCWD
    adr x1, path
    mov x2, #493                // 0755
    mov x8, #34                 // Linux AArch64 mkdirat
    svc #0
    mov x19, x0
    sub sp, sp, #16
    str x19, [sp]
    mov x0, #1
    mov x1, sp
    mov x2, #8
    mov x8, #64
    svc #0
    mov x20, #-38               // -ENOSYS; negative-baseline fixture only
    cmp x19, x20
    cset w0, ne
    mov x8, #93
    svc #0
path:
    .asciz "/workspace/notes"
