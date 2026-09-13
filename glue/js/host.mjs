const STATUS_ERROR = 0;
const STATUS_READY = 1;
const STATUS_EXITED = 2;
const NO_EXIT_CODE = -2147483648;
const EXPECTED_ABI = 5;
const EXPECTED_STDOUT = "agentvm-real-elf-pass\n";
const ENTROPY_PREFILL_BYTES = 64 * 1024;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function encodeArgv(argv) {
  if (!Array.isArray(argv) || argv.length < 1 || argv.length > 128) {
    throw new RangeError("AgentVM argv must contain 1..=128 entries");
  }
  const values = argv.map((value, index) => {
    const bytes = typeof value === "string"
      ? encoder.encode(value)
      : value instanceof Uint8Array
        ? value
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : null;
    if (!bytes || bytes.byteLength > 4096 || (index === 0 && bytes.byteLength === 0)) {
      throw new RangeError(`AgentVM argv entry ${index} has an invalid length`);
    }
    if (bytes.includes(0)) {
      throw new Error(`AgentVM argv entry ${index} contains NUL`);
    }
    return bytes;
  });
  const total = values.reduce((sum, value) => sum + 4 + value.byteLength, 4);
  if (total > 64 * 1024) {
    throw new RangeError(`AgentVM argv pack exceeds 65536 bytes: ${total}`);
  }
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, values.length, true);
  let offset = 4;
  for (const value of values) {
    view.setUint32(offset, value.byteLength, true);
    offset += 4;
    out.set(value, offset);
    offset += value.byteLength;
  }
  return out;
}

function secureEntropyBytes(length = ENTROPY_PREFILL_BYTES) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("AgentVM Wasm host requires Web Crypto getRandomValues");
  }
  if (!Number.isSafeInteger(length) || length < 1 || length > 65_536) {
    throw new RangeError(`invalid AgentVM entropy prefill length ${length}`);
  }
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export class AgentVmWasmHost {
  constructor(module, instance) {
    this.module = module;
    this.instance = instance;
    this.exports = instance.exports;
    this.memory = instance.exports.memory;
    if (!(this.memory instanceof WebAssembly.Memory)) {
      throw new Error("AgentVM Wasm module did not export linear memory");
    }
  }

  static async instantiate(wasmBytes) {
    const module = await WebAssembly.compile(wasmBytes);
    return await AgentVmWasmHost.instantiateModule(module);
  }

  static async instantiateModule(module) {
    const imports = WebAssembly.Module.imports(module);
    if (imports.length !== 0) {
      throw new Error(`unexpected host imports: ${JSON.stringify(imports)}`);
    }
    const instance = await WebAssembly.instantiate(module, {});
    const host = new AgentVmWasmHost(module, instance);
    host.supplyEntropy(secureEntropyBytes());
    return { host, imports };
  }

  abiVersion() {
    return this.exports.agentvm_wasm_abi_version();
  }

  lastError() {
    const len = this.exports.agentvm_wasm_last_error_len();
    const pointer = this.exports.agentvm_wasm_last_error_ptr();
    if (!len || !pointer) return "";
    return decoder.decode(new Uint8Array(this.memory.buffer, pointer, len));
  }

  require(value, context) {
    if (value) return value;
    const detail = this.lastError();
    throw new Error(detail ? `${context}: ${detail}` : context);
  }

  upload(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const pointer = this.require(
      this.exports.agentvm_wasm_alloc(view.byteLength),
      "AgentVM host buffer allocation failed",
    );
    new Uint8Array(this.memory.buffer, pointer, view.byteLength).set(view);
    return { pointer, len: view.byteLength };
  }

  release(pointer) {
    this.require(
      this.exports.agentvm_wasm_dealloc(pointer),
      "AgentVM host buffer release failed",
    );
  }

  supplyEntropy(bytes) {
    const uploaded = this.upload(bytes);
    try {
      return this.require(
        this.exports.agentvm_wasm_entropy_supply(uploaded.pointer, uploaded.len),
        "AgentVM entropy supply failed",
      );
    } finally {
      this.release(uploaded.pointer);
    }
  }

  entropyAvailable() {
    return this.exports.agentvm_wasm_entropy_available();
  }

  createSession(elfBytes, maxSteps = 10_000_000) {
    const uploaded = this.upload(elfBytes);
    try {
      return this.require(
        this.exports.agentvm_wasm_session_create(
          uploaded.pointer,
          uploaded.len,
          maxSteps,
        ),
        "AgentVM ELF session creation failed",
      );
    } finally {
      this.release(uploaded.pointer);
    }
  }

  createSessionWithArgv(elfBytes, argv, maxSteps = 10_000_000) {
    const elf = this.upload(elfBytes);
    let packed = null;
    try {
      packed = this.upload(encodeArgv(argv));
      return this.require(
        this.exports.agentvm_wasm_session_create_with_argv(
          elf.pointer,
          elf.len,
          packed.pointer,
          packed.len,
          maxSteps,
        ),
        "AgentVM argv ELF session creation failed",
      );
    } finally {
      if (packed) this.release(packed.pointer);
      this.release(elf.pointer);
    }
  }

  createAgentSession(elfBytes, maxSteps = 10_000_000) {
    const uploaded = this.upload(elfBytes);
    try {
      return this.require(
        this.exports.agentvm_wasm_agent_session_create(
          uploaded.pointer,
          uploaded.len,
          maxSteps,
        ),
        "AgentVM Agent ELF session creation failed",
      );
    } finally {
      this.release(uploaded.pointer);
    }
  }

  createAgentSessionWithArgv(elfBytes, argv, maxSteps = 10_000_000) {
    const elf = this.upload(elfBytes);
    let packed = null;
    try {
      packed = this.upload(encodeArgv(argv));
      return this.require(
        this.exports.agentvm_wasm_agent_session_create_with_argv(
          elf.pointer,
          elf.len,
          packed.pointer,
          packed.len,
          maxSteps,
        ),
        "AgentVM argv Agent session creation failed",
      );
    } finally {
      if (packed) this.release(packed.pointer);
      this.release(elf.pointer);
    }
  }

  createSessionFromRestart(elfBytes, restartBytes) {
    const elf = this.upload(elfBytes);
    let restart = null;
    try {
      restart = this.upload(restartBytes);
      return this.require(
        this.exports.agentvm_wasm_session_create_from_restart(
          elf.pointer,
          elf.len,
          restart.pointer,
          restart.len,
        ),
        "AgentVM restart session creation failed",
      );
    } finally {
      if (restart) this.release(restart.pointer);
      this.release(elf.pointer);
    }
  }

  createAgentSessionFromSnapshot(elfBytes, restartBytes, workspaceBytes) {
    const elf = this.upload(elfBytes);
    let restart = null;
    let workspace = null;
    try {
      restart = this.upload(restartBytes);
      workspace = this.upload(workspaceBytes);
      return this.require(
        this.exports.agentvm_wasm_agent_session_create_from_snapshot(
          elf.pointer,
          elf.len,
          restart.pointer,
          restart.len,
          workspace.pointer,
          workspace.len,
        ),
        "AgentVM AgentSnapshot session creation failed",
      );
    } finally {
      if (workspace) this.release(workspace.pointer);
      if (restart) this.release(restart.pointer);
      this.release(elf.pointer);
    }
  }

  writeWorkspace(handle, path, bytes) {
    const pathBytes = encoder.encode(path);
    const content = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const uploadedPath = this.upload(pathBytes);
    let uploadedContent = null;
    try {
      uploadedContent = this.upload(content);
      this.require(
        this.exports.agentvm_wasm_session_workspace_write(
          handle,
          uploadedPath.pointer,
          uploadedPath.len,
          uploadedContent.pointer,
          uploadedContent.len,
        ),
        "AgentVM SnapshotWorkspace write failed",
      );
    } finally {
      if (uploadedContent) this.release(uploadedContent.pointer);
      this.release(uploadedPath.pointer);
    }
  }

  run(handle, maxBlocks) {
    const status = this.exports.agentvm_wasm_session_run(handle, maxBlocks);
    if (status === STATUS_ERROR) {
      this.require(0, "AgentVM session execution failed");
    }
    return status;
  }

  state(handle) {
    const status = this.exports.agentvm_wasm_session_state(handle);
    if (status === STATUS_ERROR) {
      this.require(0, "AgentVM session state query failed");
    }
    return status;
  }

  checkpoint(handle) {
    this.require(
      this.exports.agentvm_wasm_session_checkpoint(handle),
      "AgentVM session checkpoint failed",
    );
  }

  restore(handle) {
    this.require(
      this.exports.agentvm_wasm_session_restore(handle),
      "AgentVM session restore failed",
    );
  }

  exportRestart(handle) {
    const len = this.require(
      this.exports.agentvm_wasm_session_restart_prepare(handle),
      "AgentVM restart preparation failed",
    );
    let pointer = 0;
    let consumed = false;
    try {
      pointer = this.require(
        this.exports.agentvm_wasm_alloc(len),
        "AgentVM restart transfer buffer allocation failed",
      );
      const copied = this.exports.agentvm_wasm_session_restart_copy(
        handle,
        pointer,
        len,
      );
      if (copied !== len) {
        this.require(
          0,
          `AgentVM restart copy mismatch: expected=${len} copied=${copied}`,
        );
      }
      consumed = true;
      return new Uint8Array(this.memory.buffer, pointer, len).slice();
    } finally {
      if (!consumed) {
        this.exports.agentvm_wasm_session_restart_discard(handle);
      }
      if (pointer) this.release(pointer);
    }
  }

  exportAgentSnapshot(handle) {
    this.require(
      this.exports.agentvm_wasm_session_agent_snapshot_prepare(handle),
      "AgentVM AgentSnapshot preparation failed",
    );
    try {
      return {
        restartBytes: this.#copyPrepared(
          handle,
          "agentvm_wasm_session_agent_snapshot_restart_len",
          "agentvm_wasm_session_agent_snapshot_restart_copy",
          "AgentSnapshot restart",
        ),
        workspaceBytes: this.#copyPrepared(
          handle,
          "agentvm_wasm_session_agent_snapshot_workspace_len",
          "agentvm_wasm_session_agent_snapshot_workspace_copy",
          "AgentSnapshot workspace",
        ),
      };
    } finally {
      this.require(
        this.exports.agentvm_wasm_session_agent_snapshot_discard(handle),
        "AgentVM AgentSnapshot discard failed",
      );
    }
  }

  steps(handle) {
    return this.exports.agentvm_wasm_session_steps(handle);
  }

  pc(handle) {
    return this.exports.agentvm_wasm_session_pc(handle);
  }

  exitCode(handle) {
    return this.exports.agentvm_wasm_session_exit_code(handle);
  }

  stdout(handle) {
    return this.#copyOutput(
      handle,
      "agentvm_wasm_session_stdout_len",
      "agentvm_wasm_session_stdout_copy",
    );
  }

  stderr(handle) {
    return this.#copyOutput(
      handle,
      "agentvm_wasm_session_stderr_len",
      "agentvm_wasm_session_stderr_copy",
    );
  }

  destroy(handle) {
    this.require(
      this.exports.agentvm_wasm_session_destroy(handle),
      "AgentVM session destroy failed",
    );
  }

  sessionCount() {
    return this.exports.agentvm_wasm_session_count();
  }

  #copyOutput(handle, lenExport, copyExport) {
    const len = this.exports[lenExport](handle);
    if (len === 0) {
      const error = this.lastError();
      if (error) throw new Error(error);
      return new Uint8Array();
    }
    const pointer = this.require(
      this.exports.agentvm_wasm_alloc(len),
      "AgentVM output buffer allocation failed",
    );
    try {
      const copied = this.exports[copyExport](handle, pointer, len);
      if (copied !== len) {
        this.require(
          0,
          `AgentVM output copy mismatch: expected=${len} copied=${copied}`,
        );
      }
      return new Uint8Array(this.memory.buffer, pointer, len).slice();
    } finally {
      this.release(pointer);
    }
  }

  #copyPrepared(handle, lenExport, copyExport, label) {
    const len = this.require(
      this.exports[lenExport](handle),
      `${label} length query failed`,
    );
    const pointer = this.require(
      this.exports.agentvm_wasm_alloc(len),
      `${label} transfer buffer allocation failed`,
    );
    try {
      const copied = this.exports[copyExport](handle, pointer, len);
      if (copied !== len) {
        this.require(0, `${label} copy mismatch: expected=${len} copied=${copied}`);
      }
      return new Uint8Array(this.memory.buffer, pointer, len).slice();
    } finally {
      this.release(pointer);
    }
  }
}

function validateModule(host, imports) {
  const abi = host.abiVersion();
  if (abi !== EXPECTED_ABI) {
    throw new Error(`unexpected AgentVM Wasm ABI ${abi}`);
  }
  const embedded = host.exports.agentvm_wasm_directblock_smoke();
  if ((embedded & 0xff) !== 43 || (embedded >>> 8) !== 7) {
    throw new Error(`embedded DirectBlock smoke mismatch: packed=${embedded}`);
  }
  return { abi, imports: imports.length };
}

function runUntilExit(host, handle, maxSlices = 32) {
  for (let slices = 1; slices <= maxSlices; slices += 1) {
    const status = host.run(handle, 1);
    if (status === STATUS_EXITED) return slices;
    if (status !== STATUS_READY) {
      throw new Error(
        `unexpected AgentVM session status ${status} on slice ${slices}`,
      );
    }
  }
  throw new Error(
    `AgentVM session did not exit within ${maxSlices} one-block slices: pc=0x${host.pc(handle).toString(16)} steps=${host.steps(handle)}`,
  );
}

function requireOutput(host, handle, expected, context) {
  const actual = decoder.decode(host.stdout(handle));
  if (actual !== expected) {
    throw new Error(`${context}: ${JSON.stringify(actual)}`);
  }
  return actual;
}

export async function createPortableRestart({
  wasmBytes,
  elfBytes,
  transferBlocks = 1,
}) {
  if (!Number.isSafeInteger(transferBlocks) || transferBlocks < 1 || transferBlocks > 64) {
    throw new Error(`invalid restart transfer block count ${transferBlocks}`);
  }
  const { host, imports } = await AgentVmWasmHost.instantiate(wasmBytes);
  const moduleEvidence = validateModule(host, imports);
  const handle = host.createSession(elfBytes);
  try {
    if (host.sessionCount() !== 1) {
      throw new Error(`unexpected source session count ${host.sessionCount()}`);
    }
    const entryPc = host.pc(handle);
    host.checkpoint(handle);

    for (let block = 1; block <= transferBlocks; block += 1) {
      const status = host.run(handle, 1);
      if (status !== STATUS_READY) {
        throw new Error(
          `real ELF did not remain paused at transfer block ${block}/${transferBlocks}: ${status}`,
        );
      }
    }
    const transferSteps = host.steps(handle);
    const transferPc = host.pc(handle);
    const transferStdout = requireOutput(
      host,
      handle,
      EXPECTED_STDOUT,
      "real ELF stdout mismatch at transfer boundary",
    );
    const restartBytes = host.exportRestart(handle);

    const sourceRemainingSlices = runUntilExit(host, handle);
    if (host.exitCode(handle) !== 43) {
      throw new Error(`source ELF exit mismatch: ${host.exitCode(handle)}`);
    }
    const sourceExitSteps = host.steps(handle);
    requireOutput(
      host,
      handle,
      EXPECTED_STDOUT,
      "source stdout changed after restart export",
    );

    host.restore(handle);
    if (
      host.state(handle) !== STATUS_READY ||
      host.exitCode(handle) !== NO_EXIT_CODE ||
      host.pc(handle) !== entryPc ||
      host.stdout(handle).byteLength !== 0
    ) {
      throw new Error("in-memory restore did not recover the initial source state");
    }

    const sourceReplaySlices = runUntilExit(host, handle);
    const sourceReplaySteps = host.steps(handle);
    if (
      host.exitCode(handle) !== 43 ||
      sourceReplaySteps <= sourceExitSteps ||
      sourceReplaySlices <= sourceRemainingSlices
    ) {
      throw new Error(
        `source checkpoint replay mismatch: exit=${host.exitCode(handle)} steps=${sourceReplaySteps} slices=${sourceReplaySlices}`,
      );
    }
    requireOutput(
      host,
      handle,
      EXPECTED_STDOUT,
      "source replay stdout mismatch",
    );

    return {
      restartBytes,
      source: {
        ok: true,
        ...moduleEvidence,
        wasm: true,
        realElf: true,
        guest: "aarch64-linux",
        elfBytes: elfBytes.byteLength,
        checkpoint: true,
        restore: true,
        restartBytes: restartBytes.byteLength,
        transferBlocks,
        entryPc: `0x${entryPc.toString(16)}`,
        transferPc: `0x${transferPc.toString(16)}`,
        transferSteps: Number(transferSteps),
        transferStdout,
        sourceRemainingSlices,
        sourceExitSteps: Number(sourceExitSteps),
        sourceReplaySlices,
        sourceReplaySteps: Number(sourceReplaySteps),
        exit: 43,
      },
    };
  } finally {
    host.destroy(handle);
    if (host.sessionCount() !== 0) {
      throw new Error(`source session leak detected: ${host.sessionCount()}`);
    }
  }
}

export async function restorePortableRestart({
  wasmBytes,
  elfBytes,
  restartBytes,
  expected,
}) {
  const { host, imports } = await AgentVmWasmHost.instantiate(wasmBytes);
  const moduleEvidence = validateModule(host, imports);
  const handle = host.createSessionFromRestart(elfBytes, restartBytes);
  try {
    if (host.sessionCount() !== 1) {
      throw new Error(`unexpected restored session count ${host.sessionCount()}`);
    }
    const restoredPc = `0x${host.pc(handle).toString(16)}`;
    const restoredSteps = Number(host.steps(handle));
    const restoredStdout = decoder.decode(host.stdout(handle));
    if (
      host.state(handle) !== STATUS_READY ||
      host.exitCode(handle) !== NO_EXIT_CODE ||
      restoredPc !== expected.transferPc ||
      restoredSteps !== expected.transferSteps ||
      restoredStdout !== expected.transferStdout
    ) {
      throw new Error(
        `restart transfer boundary mismatch: pc=${restoredPc}/${expected.transferPc} steps=${restoredSteps}/${expected.transferSteps} stdout=${JSON.stringify(restoredStdout)}`,
      );
    }

    const restoredSlices = runUntilExit(host, handle);
    const restoredExitSteps = Number(host.steps(handle));
    const finalStdout = requireOutput(
      host,
      handle,
      EXPECTED_STDOUT,
      "restored session stdout mismatch",
    );
    if (host.exitCode(handle) !== 43) {
      throw new Error(`restored ELF exit mismatch: ${host.exitCode(handle)}`);
    }

    return {
      ok: true,
      ...moduleEvidence,
      wasm: true,
      realElf: true,
      freshInstance: true,
      guest: "aarch64-linux",
      elfBytes: elfBytes.byteLength,
      restartBytes: restartBytes.byteLength,
      restoredPc,
      restoredSteps,
      restoredStdout,
      restoredSlices,
      restoredExitSteps,
      stdout: finalStdout,
      exit: 43,
    };
  } finally {
    host.destroy(handle);
    if (host.sessionCount() !== 0) {
      throw new Error(`restored session leak detected: ${host.sessionCount()}`);
    }
  }
}

export async function createPortableAgentSnapshot({
  wasmBytes,
  elfBytes,
  workspaceContent,
  transferBlocks = 1,
}) {
  if (!Number.isSafeInteger(transferBlocks) || transferBlocks < 1) {
    throw new Error(`invalid AgentSnapshot transfer block count ${transferBlocks}`);
  }
  const content = workspaceContent instanceof Uint8Array
    ? workspaceContent
    : encoder.encode(String(workspaceContent));
  if (content.byteLength === 0) {
    throw new Error("AgentSnapshot workspace content must be nonempty");
  }

  const { host, imports } = await AgentVmWasmHost.instantiate(wasmBytes);
  const moduleEvidence = validateModule(host, imports);
  const handle = host.createAgentSession(elfBytes);
  try {
    host.writeWorkspace(handle, "/workspace/state.txt", content);
    const transferStatus = host.run(handle, transferBlocks);
    if (transferStatus !== STATUS_READY) {
      throw new Error(
        `workspace guest did not pause after ${transferBlocks} blocks: ${transferStatus}`,
      );
    }
    const transferSteps = Number(host.steps(handle));
    const transferPc = `0x${host.pc(handle).toString(16)}`;
    if (host.stdout(handle).byteLength !== 0) {
      throw new Error("workspace guest emitted output before AgentSnapshot boundary");
    }

    const snapshot = host.exportAgentSnapshot(handle);
    const sourceRemainingSlices = runUntilExit(host, handle, 64);
    const stdout = decoder.decode(host.stdout(handle));
    const expectedStdout = decoder.decode(content);
    if (host.exitCode(handle) !== 43 || stdout !== expectedStdout) {
      throw new Error(
        `source AgentSnapshot guest mismatch: exit=${host.exitCode(handle)} stdout=${JSON.stringify(stdout)}`,
      );
    }

    return {
      ...snapshot,
      source: {
        ok: true,
        ...moduleEvidence,
        wasm: true,
        realElf: true,
        guest: "aarch64-linux",
        agentSnapshot: true,
        workspace: true,
        guestWorkspaceRead: true,
        elfBytes: elfBytes.byteLength,
        restartBytes: snapshot.restartBytes.byteLength,
        workspaceBytes: snapshot.workspaceBytes.byteLength,
        workspaceText: expectedStdout,
        transferBlocks,
        transferPc,
        transferSteps,
        sourceRemainingSlices,
        sourceExitSteps: Number(host.steps(handle)),
        exit: 43,
      },
    };
  } finally {
    host.destroy(handle);
    if (host.sessionCount() !== 0) {
      throw new Error(`AgentSnapshot source session leak detected: ${host.sessionCount()}`);
    }
  }
}

export async function restorePortableAgentSnapshot({
  wasmBytes,
  elfBytes,
  restartBytes,
  workspaceBytes,
  expected,
}) {
  const { host, imports } = await AgentVmWasmHost.instantiate(wasmBytes);
  const moduleEvidence = validateModule(host, imports);
  const handle = host.createAgentSessionFromSnapshot(
    elfBytes,
    restartBytes,
    workspaceBytes,
  );
  try {
    const restoredPc = `0x${host.pc(handle).toString(16)}`;
    const restoredSteps = Number(host.steps(handle));
    if (
      host.state(handle) !== STATUS_READY ||
      host.exitCode(handle) !== NO_EXIT_CODE ||
      restoredPc !== expected.transferPc ||
      restoredSteps !== expected.transferSteps ||
      host.stdout(handle).byteLength !== 0
    ) {
      throw new Error(
        `AgentSnapshot transfer boundary mismatch: pc=${restoredPc}/${expected.transferPc} steps=${restoredSteps}/${expected.transferSteps}`,
      );
    }

    const restoredSlices = runUntilExit(host, handle, 64);
    const stdout = decoder.decode(host.stdout(handle));
    if (host.exitCode(handle) !== 43 || stdout !== expected.workspaceText) {
      throw new Error(
        `restored AgentSnapshot guest mismatch: exit=${host.exitCode(handle)} stdout=${JSON.stringify(stdout)}`,
      );
    }
    return {
      ok: true,
      ...moduleEvidence,
      wasm: true,
      realElf: true,
      freshInstance: true,
      guest: "aarch64-linux",
      agentSnapshot: true,
      workspace: true,
      guestWorkspaceRead: true,
      elfBytes: elfBytes.byteLength,
      restartBytes: restartBytes.byteLength,
      workspaceBytes: workspaceBytes.byteLength,
      restoredPc,
      restoredSteps,
      restoredSlices,
      restoredExitSteps: Number(host.steps(handle)),
      stdout,
      exit: 43,
    };
  } finally {
    host.destroy(handle);
    if (host.sessionCount() !== 0) {
      throw new Error(`AgentSnapshot restore session leak detected: ${host.sessionCount()}`);
    }
  }
}

export async function runPortableElfGate({ wasmBytes, elfBytes, worker }) {
  const { restartBytes, source } = await createPortableRestart({
    wasmBytes,
    elfBytes,
  });
  const restored = await restorePortableRestart({
    wasmBytes,
    elfBytes,
    restartBytes,
    expected: source,
  });
  const marker = `AGENTVM_CROSSOS_PORTABLE_RESTART_PASS abi=${source.abi} imports=${source.imports} worker=${worker} fresh_instance=true guest=aarch64-linux elf_bytes=${source.elfBytes} restart_bytes=${source.restartBytes} checkpoint=true restore=true transfer_steps=${source.transferSteps} restored_slices=${restored.restoredSlices} exit=43 source_replay_steps=${source.sourceReplaySteps}`;
  return {
    ok: true,
    abi: source.abi,
    imports: source.imports,
    worker,
    wasm: true,
    realElf: true,
    freshInstance: true,
    restartTransfer: true,
    guest: "aarch64-linux",
    elfBytes: source.elfBytes,
    restartBytes: source.restartBytes,
    checkpoint: true,
    restore: true,
    transferPc: source.transferPc,
    transferSteps: source.transferSteps,
    restoredSlices: restored.restoredSlices,
    restoredExitSteps: restored.restoredExitSteps,
    sourceReplaySteps: source.sourceReplaySteps,
    stdout: restored.stdout,
    exit: 43,
    marker,
  };
}
