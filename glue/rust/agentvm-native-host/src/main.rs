use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Write};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use serde::Serialize;

const ABI_VERSION: i32 = 5;
const STATUS_READY: i32 = 1;
const STATUS_EXITED: i32 = 2;
const MAX_STEPS: i32 = 100_000_000;
const MAX_RUN_CALLS: u32 = 64;
const BLOCKS_PER_RUN: i32 = 1_000_000;
const REAL_TOOL_INPUT: &[u8] = b"alpha\nneedle one\nbeta needle two\nomega\n";
const RIPGREP_OUTPUT: &[u8] = b"2:needle one\n3:beta needle two\n";

fn large_ripgrep_fixture() -> &'static (Vec<u8>, Vec<u8>) {
    static FIXTURE: OnceLock<(Vec<u8>, Vec<u8>)> = OnceLock::new();
    FIXTURE.get_or_init(|| {
        const SIZE: usize = 1_048_576;
        const PLAIN: &[u8; 64] = b"abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ!\n";
        const MATCH: &[u8; 64] = b"needle-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n";
        let mut input = Vec::with_capacity(SIZE);
        let mut expected = Vec::new();
        for line in 1..=SIZE / 64 {
            let bytes = if line % 4096 == 0 { MATCH } else { PLAIN };
            input.extend_from_slice(bytes);
            if line % 4096 == 0 {
                expected.extend_from_slice(line.to_string().as_bytes());
                expected.push(b':');
                expected.extend_from_slice(MATCH);
            }
        }
        assert_eq!(input.len(), SIZE);
        (input, expected)
    })
}

#[derive(Debug, Clone)]
struct Workload {
    name: String,
    elf: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
struct Stats {
    n: usize,
    p50_ms: f64,
    p95_ms: f64,
    trimmed_mean_ms: f64,
    min_ms: f64,
    max_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
struct WorkloadResult {
    create: Stats,
    run: Stats,
    total: Stats,
    run_calls: Vec<u32>,
    steps: u64,
}

#[derive(Debug, Clone, Serialize)]
struct BenchResult {
    engine: String,
    engine_version: String,
    wasm_bytes: usize,
    imports: usize,
    abi: i32,
    compile_first_ms: f64,
    instantiate: Stats,
    results: BTreeMap<String, WorkloadResult>,
}

fn millis(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

fn stats(values: &[f64]) -> Stats {
    assert!(!values.is_empty());
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let n = sorted.len();
    let p50 = if n % 2 == 1 {
        sorted[n / 2]
    } else {
        (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
    };
    let p95 = sorted[((n as f64 * 0.95).ceil() as usize).saturating_sub(1).min(n - 1)];
    let trim = n / 10;
    let trimmed = if trim > 0 && trim * 2 < n {
        &sorted[trim..n - trim]
    } else {
        &sorted[..]
    };
    Stats {
        n,
        p50_ms: p50,
        p95_ms: p95,
        trimmed_mean_ms: trimmed.iter().sum::<f64>() / trimmed.len() as f64,
        min_ms: sorted[0],
        max_ms: sorted[n - 1],
    }
}

fn encode_argv(values: &[&[u8]]) -> Result<Vec<u8>> {
    if values.is_empty() || values.len() > 128 {
        bail!("argv must contain 1..=128 entries");
    }
    let mut total = 4usize;
    for (index, value) in values.iter().enumerate() {
        if value.len() > 4096 || (index == 0 && value.is_empty()) || value.contains(&0) {
            bail!("invalid argv entry {index}");
        }
        total = total
            .checked_add(4 + value.len())
            .ok_or_else(|| anyhow!("argv size overflow"))?;
    }
    if total > 64 * 1024 {
        bail!("argv pack exceeds 64 KiB");
    }
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(&(values.len() as u32).to_le_bytes());
    for value in values {
        out.extend_from_slice(&(value.len() as u32).to_le_bytes());
        out.extend_from_slice(value);
    }
    Ok(out)
}

trait ResidentHost {
    fn abi(&mut self) -> Result<i32>;
    fn create(&mut self, elf: &[u8], argv: Option<&[u8]>) -> Result<i32>;
    fn run(&mut self, handle: i32, max_blocks: i32) -> Result<i32>;
    fn steps(&mut self, handle: i32) -> Result<u64>;
    fn exit_code(&mut self, handle: i32) -> Result<i32>;
    fn stdout(&mut self, handle: i32) -> Result<Vec<u8>>;
    fn stderr(&mut self, handle: i32) -> Result<Vec<u8>>;
    fn destroy(&mut self, handle: i32) -> Result<()>;
    fn session_count(&mut self) -> Result<i32>;
    fn supply_entropy(&mut self, bytes: &[u8]) -> Result<()>;
    fn create_agent(&mut self, elf: &[u8], argv: &[u8]) -> Result<i32>;
    fn write_workspace(&mut self, handle: i32, path: &[u8], bytes: &[u8]) -> Result<()>;
}

fn run_one<H: ResidentHost>(host: &mut H, workload: &Workload) -> Result<(f64, f64, f64, u32, u64)> {
    let argv = match workload.name.as_str() {
        "true" => Some(encode_argv(&[b"busybox", b"true"])?),
        "busybox-cat" => Some(encode_argv(&[b"busybox", b"cat", b"/workspace/input.txt"])?),
        "ripgrep" | "ripgrep-1m" => Some(encode_argv(&[
            b"rg",
            b"--threads",
            b"1",
            b"-n",
            b"needle",
            b"/workspace/input.txt",
        ])?),
        _ => None,
    };
    let start = Instant::now();
    let is_real_tool = matches!(workload.name.as_str(), "busybox-cat" | "ripgrep" | "ripgrep-1m");
    let handle = if is_real_tool {
        host.create_agent(&workload.elf, argv.as_deref().expect("real tool argv"))?
    } else {
        host.create(&workload.elf, argv.as_deref())?
    };
    if is_real_tool {
        let input = if workload.name == "ripgrep-1m" {
            large_ripgrep_fixture().0.as_slice()
        } else {
            REAL_TOOL_INPUT
        };
        host.write_workspace(handle, b"/workspace/input.txt", input)?;
    }
    let after_create = Instant::now();
    let mut status = STATUS_READY;
    let mut calls = 0_u32;
    while status != STATUS_EXITED {
        status = host.run(handle, BLOCKS_PER_RUN)?;
        calls += 1;
        if status != STATUS_READY && status != STATUS_EXITED {
            bail!("{} returned unexpected status {status}", workload.name);
        }
        if calls > MAX_RUN_CALLS {
            bail!("{} exceeded run-call bound", workload.name);
        }
    }
    let after_run = Instant::now();
    let steps = host.steps(handle)?;
    let exit = host.exit_code(handle)?;
    let stdout = host.stdout(handle)?;
    let stderr = host.stderr(handle)?;
    let expected_stdout: &[u8] = match workload.name.as_str() {
        "true" => b"",
        "busybox-cat" => REAL_TOOL_INPUT,
        "ripgrep" => RIPGREP_OUTPUT,
        "ripgrep-1m" => large_ripgrep_fixture().1.as_slice(),
        _ => b"OK\n",
    };
    if exit != 0 || stdout != expected_stdout || !stderr.is_empty() {
        bail!(
            "{} semantic mismatch exit={} stdout={:?} stderr={:?}",
            workload.name,
            exit,
            String::from_utf8_lossy(&stdout),
            String::from_utf8_lossy(&stderr)
        );
    }
    host.destroy(handle)?;
    if host.session_count()? != 0 {
        bail!("{} leaked a session", workload.name);
    }
    Ok((
        millis(after_create.duration_since(start)),
        millis(after_run.duration_since(after_create)),
        millis(after_run.duration_since(start)),
        calls,
        steps,
    ))
}

fn benchmark_host<H: ResidentHost>(
    host: &mut H,
    workloads: &[Workload],
    iterations: usize,
) -> Result<BTreeMap<String, WorkloadResult>> {
    // This benchmark module is import-free; seed its explicit entropy pool once
    // before timing so real tools exercise the same host-neutral ABI without
    // putting entropy acquisition inside any sample.
    host.supply_entropy(&vec![0xa5; 64 * 1024])?;
    let mut results = BTreeMap::new();
    for workload in workloads {
        let mut create = Vec::with_capacity(iterations);
        let mut run = Vec::with_capacity(iterations);
        let mut total = Vec::with_capacity(iterations);
        let mut calls = Vec::with_capacity(iterations);
        let mut steps = Vec::with_capacity(iterations);
        for sample in 0..iterations + 3 {
            let (create_ms, run_ms, total_ms, call_count, step_count) =
                run_one(host, workload)?;
            if sample >= 3 {
                create.push(create_ms);
                run.push(run_ms);
                total.push(total_ms);
                calls.push(call_count);
                steps.push(step_count);
            }
        }
        calls.sort_unstable();
        calls.dedup();
        steps.sort_unstable();
        steps.dedup();
        if steps.len() != 1 {
            bail!("{} guest step count drifted: {steps:?}", workload.name);
        }
        results.insert(
            workload.name.clone(),
            WorkloadResult {
                create: stats(&create),
                run: stats(&run),
                total: stats(&total),
                run_calls: calls,
                steps: steps[0],
            },
        );
    }
    Ok(results)
}

mod wasmtime_host {
    use super::*;
    use wasmtime::error::Context as _;
    use wasmtime::{Engine, Instance, Memory, Module, Store, TypedFunc};

    pub struct Host {
        store: Store<()>,
        memory: Memory,
        alloc: TypedFunc<i32, i32>,
        dealloc: TypedFunc<i32, i32>,
        create: TypedFunc<(i32, i32, i32), i32>,
        create_argv: TypedFunc<(i32, i32, i32, i32, i32), i32>,
        run: TypedFunc<(i32, i32), i32>,
        steps: TypedFunc<i32, i64>,
        exit_code: TypedFunc<i32, i32>,
        stdout_len: TypedFunc<i32, i32>,
        stdout_copy: TypedFunc<(i32, i32, i32), i32>,
        stderr_len: TypedFunc<i32, i32>,
        stderr_copy: TypedFunc<(i32, i32, i32), i32>,
        destroy: TypedFunc<i32, i32>,
        count: TypedFunc<(), i32>,
        abi: TypedFunc<(), i32>,
        entropy_supply: TypedFunc<(i32, i32), i32>,
        create_agent_argv: TypedFunc<(i32, i32, i32, i32, i32), i32>,
        workspace_write: TypedFunc<(i32, i32, i32, i32, i32), i32>,
    }

    impl Host {
        fn from_instance(mut store: Store<()>, instance: Instance) -> Result<Self> {
            let memory = instance
                .get_memory(&mut store, "memory")
                .ok_or_else(|| anyhow!("missing exported memory"))?;
            macro_rules! typed {
                ($name:literal, $p:ty, $r:ty) => {
                    instance
                        .get_typed_func::<$p, $r>(&mut store, $name)
                        .with_context(|| format!("missing export {}", $name))?
                };
            }
            Ok(Self {
                alloc: typed!("agentvm_wasm_alloc", i32, i32),
                dealloc: typed!("agentvm_wasm_dealloc", i32, i32),
                create: typed!("agentvm_wasm_session_create", (i32, i32, i32), i32),
                create_argv: typed!(
                    "agentvm_wasm_session_create_with_argv",
                    (i32, i32, i32, i32, i32),
                    i32
                ),
                run: typed!("agentvm_wasm_session_run", (i32, i32), i32),
                steps: typed!("agentvm_wasm_session_steps", i32, i64),
                exit_code: typed!("agentvm_wasm_session_exit_code", i32, i32),
                stdout_len: typed!("agentvm_wasm_session_stdout_len", i32, i32),
                stdout_copy: typed!("agentvm_wasm_session_stdout_copy", (i32, i32, i32), i32),
                stderr_len: typed!("agentvm_wasm_session_stderr_len", i32, i32),
                stderr_copy: typed!("agentvm_wasm_session_stderr_copy", (i32, i32, i32), i32),
                destroy: typed!("agentvm_wasm_session_destroy", i32, i32),
                count: typed!("agentvm_wasm_session_count", (), i32),
                abi: typed!("agentvm_wasm_abi_version", (), i32),
                entropy_supply: typed!("agentvm_wasm_entropy_supply", (i32, i32), i32),
                create_agent_argv: typed!(
                    "agentvm_wasm_agent_session_create_with_argv",
                    (i32, i32, i32, i32, i32),
                    i32
                ),
                workspace_write: typed!(
                    "agentvm_wasm_session_workspace_write",
                    (i32, i32, i32, i32, i32),
                    i32
                ),
                store,
                memory,
            })
        }

        fn upload(&mut self, bytes: &[u8]) -> Result<i32> {
            let pointer = self.alloc.call(&mut self.store, bytes.len() as i32)?;
            if pointer == 0 {
                bail!("Wasm alloc failed");
            }
            self.memory
                .write(&mut self.store, pointer as usize, bytes)
                .map_err(|error| anyhow!("write uploaded bytes: {error}"))?;
            Ok(pointer)
        }

        fn release(&mut self, pointer: i32) -> Result<()> {
            if self.dealloc.call(&mut self.store, pointer)? == 0 {
                bail!("Wasm dealloc failed");
            }
            Ok(())
        }

        fn output(
            &mut self,
            handle: i32,
            len_func: TypedFunc<i32, i32>,
            copy_func: TypedFunc<(i32, i32, i32), i32>,
        ) -> Result<Vec<u8>> {
            let len = len_func.call(&mut self.store, handle)?;
            if len == 0 {
                return Ok(Vec::new());
            }
            let pointer = self.alloc.call(&mut self.store, len)?;
            if pointer == 0 {
                bail!("output allocation failed");
            }
            let copied = copy_func.call(&mut self.store, (handle, pointer, len))?;
            if copied != len {
                bail!("output copy mismatch {copied} != {len}");
            }
            let mut bytes = vec![0_u8; len as usize];
            self.memory.read(&self.store, pointer as usize, &mut bytes)?;
            self.release(pointer)?;
            Ok(bytes)
        }
    }

    pub fn instantiate(wasm: &[u8]) -> Result<Host> {
        let engine = Engine::default();
        let module = Module::from_binary(&engine, wasm)?;
        let imports = module.imports().count();
        if imports != 0 {
            bail!("module unexpectedly imports {imports} items");
        }
        let mut store = Store::new(&engine, ());
        let instance = Instance::new(&mut store, &module, &[])?;
        let mut host = Host::from_instance(store, instance)?;
        let abi = host.abi()?;
        if abi != ABI_VERSION {
            bail!("unexpected ABI {abi}");
        }
        Ok(host)
    }

    impl ResidentHost for Host {
        fn abi(&mut self) -> Result<i32> {
            Ok(self.abi.call(&mut self.store, ())?)
        }
        fn create(&mut self, elf: &[u8], argv: Option<&[u8]>) -> Result<i32> {
            let elf_ptr = self.upload(elf)?;
            let result = if let Some(argv) = argv {
                let argv_ptr = self.upload(argv)?;
                let handle = self.create_argv.call(
                    &mut self.store,
                    (elf_ptr, elf.len() as i32, argv_ptr, argv.len() as i32, MAX_STEPS),
                )?;
                self.release(argv_ptr)?;
                handle
            } else {
                self.create
                    .call(&mut self.store, (elf_ptr, elf.len() as i32, MAX_STEPS))?
            };
            self.release(elf_ptr)?;
            if result == 0 {
                bail!("session creation failed");
            }
            Ok(result)
        }
        fn run(&mut self, handle: i32, max_blocks: i32) -> Result<i32> {
            Ok(self.run.call(&mut self.store, (handle, max_blocks))?)
        }
        fn steps(&mut self, handle: i32) -> Result<u64> {
            Ok(self.steps.call(&mut self.store, handle)? as u64)
        }
        fn exit_code(&mut self, handle: i32) -> Result<i32> {
            Ok(self.exit_code.call(&mut self.store, handle)?)
        }
        fn stdout(&mut self, handle: i32) -> Result<Vec<u8>> {
            self.output(handle, self.stdout_len.clone(), self.stdout_copy.clone())
        }
        fn stderr(&mut self, handle: i32) -> Result<Vec<u8>> {
            self.output(handle, self.stderr_len.clone(), self.stderr_copy.clone())
        }
        fn destroy(&mut self, handle: i32) -> Result<()> {
            if self.destroy.call(&mut self.store, handle)? == 0 {
                bail!("session destroy failed");
            }
            Ok(())
        }
        fn session_count(&mut self) -> Result<i32> {
            Ok(self.count.call(&mut self.store, ())?)
        }
        fn supply_entropy(&mut self, bytes: &[u8]) -> Result<()> {
            let pointer = self.upload(bytes)?;
            let accepted = self
                .entropy_supply
                .call(&mut self.store, (pointer, bytes.len() as i32))?;
            self.release(pointer)?;
            if accepted == 0 {
                bail!("entropy supply failed");
            }
            Ok(())
        }
        fn create_agent(&mut self, elf: &[u8], argv: &[u8]) -> Result<i32> {
            let elf_ptr = self.upload(elf)?;
            let argv_ptr = self.upload(argv)?;
            let handle = self.create_agent_argv.call(
                &mut self.store,
                (elf_ptr, elf.len() as i32, argv_ptr, argv.len() as i32, 500_000_000_i32),
            )?;
            self.release(argv_ptr)?;
            self.release(elf_ptr)?;
            if handle == 0 {
                bail!("Agent session creation failed");
            }
            Ok(handle)
        }
        fn write_workspace(&mut self, handle: i32, path: &[u8], bytes: &[u8]) -> Result<()> {
            let path_ptr = self.upload(path)?;
            let bytes_ptr = self.upload(bytes)?;
            let ok = self.workspace_write.call(
                &mut self.store,
                (handle, path_ptr, path.len() as i32, bytes_ptr, bytes.len() as i32),
            )?;
            self.release(bytes_ptr)?;
            self.release(path_ptr)?;
            if ok == 0 {
                bail!("workspace write failed");
            }
            Ok(())
        }
    }

    pub fn benchmark(wasm: &[u8], workloads: &[Workload], iterations: usize) -> Result<BenchResult> {
        let engine = Engine::default();
        let compile_start = Instant::now();
        let module = Module::from_binary(&engine, wasm)?;
        let compile_first_ms = millis(compile_start.elapsed());
        let imports = module.imports().count();
        if imports != 0 {
            bail!("module unexpectedly imports {imports} items");
        }
        let mut instantiate = Vec::new();
        for _ in 0..7 {
            let start = Instant::now();
            let mut store = Store::new(&engine, ());
            let instance = Instance::new(&mut store, &module, &[])?;
            let _ = Host::from_instance(store, instance)?;
            instantiate.push(millis(start.elapsed()));
        }
        let mut store = Store::new(&engine, ());
        let instance = Instance::new(&mut store, &module, &[])?;
        let mut host = Host::from_instance(store, instance)?;
        let abi = host.abi()?;
        if abi != ABI_VERSION {
            bail!("unexpected ABI {abi}");
        }
        let results = benchmark_host(&mut host, workloads, iterations)?;
        Ok(BenchResult {
            engine: "wasmtime".to_string(),
            engine_version: "49.0.0-rc.1".to_string(),
            wasm_bytes: wasm.len(),
            imports,
            abi,
            compile_first_ms,
            instantiate: stats(&instantiate),
            results,
        })
    }
}

mod wasmi_host {
    use super::*;
    use wasmi::{Engine, Instance, Linker, Memory, Module, Store, TypedFunc};

    pub struct Host {
        store: Store<()>,
        memory: Memory,
        alloc: TypedFunc<i32, i32>,
        dealloc: TypedFunc<i32, i32>,
        create: TypedFunc<(i32, i32, i32), i32>,
        create_argv: TypedFunc<(i32, i32, i32, i32, i32), i32>,
        run: TypedFunc<(i32, i32), i32>,
        steps: TypedFunc<i32, i64>,
        exit_code: TypedFunc<i32, i32>,
        stdout_len: TypedFunc<i32, i32>,
        stdout_copy: TypedFunc<(i32, i32, i32), i32>,
        stderr_len: TypedFunc<i32, i32>,
        stderr_copy: TypedFunc<(i32, i32, i32), i32>,
        destroy: TypedFunc<i32, i32>,
        count: TypedFunc<(), i32>,
        abi: TypedFunc<(), i32>,
        entropy_supply: TypedFunc<(i32, i32), i32>,
        create_agent_argv: TypedFunc<(i32, i32, i32, i32, i32), i32>,
        workspace_write: TypedFunc<(i32, i32, i32, i32, i32), i32>,
    }

    impl Host {
        fn from_instance(store: Store<()>, instance: Instance) -> Result<Self> {
            let memory = instance
                .get_memory(&store, "memory")
                .ok_or_else(|| anyhow!("missing exported memory"))?;
            macro_rules! typed {
                ($name:literal, $p:ty, $r:ty) => {
                    instance
                        .get_typed_func::<$p, $r>(&store, $name)
                        .with_context(|| format!("missing export {}", $name))?
                };
            }
            Ok(Self {
                alloc: typed!("agentvm_wasm_alloc", i32, i32),
                dealloc: typed!("agentvm_wasm_dealloc", i32, i32),
                create: typed!("agentvm_wasm_session_create", (i32, i32, i32), i32),
                create_argv: typed!(
                    "agentvm_wasm_session_create_with_argv",
                    (i32, i32, i32, i32, i32),
                    i32
                ),
                run: typed!("agentvm_wasm_session_run", (i32, i32), i32),
                steps: typed!("agentvm_wasm_session_steps", i32, i64),
                exit_code: typed!("agentvm_wasm_session_exit_code", i32, i32),
                stdout_len: typed!("agentvm_wasm_session_stdout_len", i32, i32),
                stdout_copy: typed!("agentvm_wasm_session_stdout_copy", (i32, i32, i32), i32),
                stderr_len: typed!("agentvm_wasm_session_stderr_len", i32, i32),
                stderr_copy: typed!("agentvm_wasm_session_stderr_copy", (i32, i32, i32), i32),
                destroy: typed!("agentvm_wasm_session_destroy", i32, i32),
                count: typed!("agentvm_wasm_session_count", (), i32),
                abi: typed!("agentvm_wasm_abi_version", (), i32),
                entropy_supply: typed!("agentvm_wasm_entropy_supply", (i32, i32), i32),
                create_agent_argv: typed!(
                    "agentvm_wasm_agent_session_create_with_argv",
                    (i32, i32, i32, i32, i32),
                    i32
                ),
                workspace_write: typed!(
                    "agentvm_wasm_session_workspace_write",
                    (i32, i32, i32, i32, i32),
                    i32
                ),
                store,
                memory,
            })
        }

        fn upload(&mut self, bytes: &[u8]) -> Result<i32> {
            let pointer = self.alloc.call(&mut self.store, bytes.len() as i32)?;
            if pointer == 0 {
                bail!("Wasm alloc failed");
            }
            self.memory.write(&mut self.store, pointer as usize, bytes)?;
            Ok(pointer)
        }

        fn release(&mut self, pointer: i32) -> Result<()> {
            if self.dealloc.call(&mut self.store, pointer)? == 0 {
                bail!("Wasm dealloc failed");
            }
            Ok(())
        }

        fn output(
            &mut self,
            handle: i32,
            len_func: TypedFunc<i32, i32>,
            copy_func: TypedFunc<(i32, i32, i32), i32>,
        ) -> Result<Vec<u8>> {
            let len = len_func.call(&mut self.store, handle)?;
            if len == 0 {
                return Ok(Vec::new());
            }
            let pointer = self.alloc.call(&mut self.store, len)?;
            if pointer == 0 {
                bail!("output allocation failed");
            }
            let copied = copy_func.call(&mut self.store, (handle, pointer, len))?;
            if copied != len {
                bail!("output copy mismatch {copied} != {len}");
            }
            let mut bytes = vec![0_u8; len as usize];
            self.memory.read(&self.store, pointer as usize, &mut bytes)?;
            self.release(pointer)?;
            Ok(bytes)
        }
    }

    pub fn instantiate(wasm: &[u8]) -> Result<Host> {
        let engine = Engine::default();
        let module = Module::new(&engine, wasm)?;
        let mut store = Store::new(&engine, ());
        let linker = <Linker<()>>::new(&engine);
        let instance = linker.instantiate_and_start(&mut store, &module)?;
        let mut host = Host::from_instance(store, instance)?;
        let abi = host.abi()?;
        if abi != ABI_VERSION {
            bail!("unexpected ABI {abi}");
        }
        Ok(host)
    }

    impl ResidentHost for Host {
        fn abi(&mut self) -> Result<i32> {
            Ok(self.abi.call(&mut self.store, ())?)
        }
        fn create(&mut self, elf: &[u8], argv: Option<&[u8]>) -> Result<i32> {
            let elf_ptr = self.upload(elf)?;
            let result = if let Some(argv) = argv {
                let argv_ptr = self.upload(argv)?;
                let handle = self.create_argv.call(
                    &mut self.store,
                    (elf_ptr, elf.len() as i32, argv_ptr, argv.len() as i32, MAX_STEPS),
                )?;
                self.release(argv_ptr)?;
                handle
            } else {
                self.create
                    .call(&mut self.store, (elf_ptr, elf.len() as i32, MAX_STEPS))?
            };
            self.release(elf_ptr)?;
            if result == 0 {
                bail!("session creation failed");
            }
            Ok(result)
        }
        fn run(&mut self, handle: i32, max_blocks: i32) -> Result<i32> {
            Ok(self.run.call(&mut self.store, (handle, max_blocks))?)
        }
        fn steps(&mut self, handle: i32) -> Result<u64> {
            Ok(self.steps.call(&mut self.store, handle)? as u64)
        }
        fn exit_code(&mut self, handle: i32) -> Result<i32> {
            Ok(self.exit_code.call(&mut self.store, handle)?)
        }
        fn stdout(&mut self, handle: i32) -> Result<Vec<u8>> {
            self.output(handle, self.stdout_len, self.stdout_copy)
        }
        fn stderr(&mut self, handle: i32) -> Result<Vec<u8>> {
            self.output(handle, self.stderr_len, self.stderr_copy)
        }
        fn destroy(&mut self, handle: i32) -> Result<()> {
            if self.destroy.call(&mut self.store, handle)? == 0 {
                bail!("session destroy failed");
            }
            Ok(())
        }
        fn session_count(&mut self) -> Result<i32> {
            Ok(self.count.call(&mut self.store, ())?)
        }
        fn supply_entropy(&mut self, bytes: &[u8]) -> Result<()> {
            let pointer = self.upload(bytes)?;
            let accepted = self
                .entropy_supply
                .call(&mut self.store, (pointer, bytes.len() as i32))?;
            self.release(pointer)?;
            if accepted == 0 {
                bail!("entropy supply failed");
            }
            Ok(())
        }
        fn create_agent(&mut self, elf: &[u8], argv: &[u8]) -> Result<i32> {
            let elf_ptr = self.upload(elf)?;
            let argv_ptr = self.upload(argv)?;
            let handle = self.create_agent_argv.call(
                &mut self.store,
                (elf_ptr, elf.len() as i32, argv_ptr, argv.len() as i32, 500_000_000_i32),
            )?;
            self.release(argv_ptr)?;
            self.release(elf_ptr)?;
            if handle == 0 {
                bail!("Agent session creation failed");
            }
            Ok(handle)
        }
        fn write_workspace(&mut self, handle: i32, path: &[u8], bytes: &[u8]) -> Result<()> {
            let path_ptr = self.upload(path)?;
            let bytes_ptr = self.upload(bytes)?;
            let ok = self.workspace_write.call(
                &mut self.store,
                (handle, path_ptr, path.len() as i32, bytes_ptr, bytes.len() as i32),
            )?;
            self.release(bytes_ptr)?;
            self.release(path_ptr)?;
            if ok == 0 {
                bail!("workspace write failed");
            }
            Ok(())
        }
    }

    pub fn benchmark(wasm: &[u8], workloads: &[Workload], iterations: usize) -> Result<BenchResult> {
        let engine = Engine::default();
        let compile_start = Instant::now();
        let module = Module::new(&engine, wasm)?;
        let compile_first_ms = millis(compile_start.elapsed());
        let mut instantiate = Vec::new();
        for _ in 0..7 {
            let start = Instant::now();
            let mut store = Store::new(&engine, ());
            let linker = <Linker<()>>::new(&engine);
            let instance = linker.instantiate_and_start(&mut store, &module)?;
            let _ = Host::from_instance(store, instance)?;
            instantiate.push(millis(start.elapsed()));
        }
        let mut store = Store::new(&engine, ());
        let linker = <Linker<()>>::new(&engine);
        let instance = linker.instantiate_and_start(&mut store, &module)?;
        let mut host = Host::from_instance(store, instance)?;
        let abi = host.abi()?;
        if abi != ABI_VERSION {
            bail!("unexpected ABI {abi}");
        }
        let results = benchmark_host(&mut host, workloads, iterations)?;
        Ok(BenchResult {
            engine: "wasmi".to_string(),
            engine_version: "2.0.0".to_string(),
            wasm_bytes: wasm.len(),
            imports: 0,
            abi,
            compile_first_ms,
            instantiate: stats(&instantiate),
            results,
        })
    }
}

fn parse_workloads(args: &[String]) -> Result<Vec<Workload>> {
    if !args.len().is_multiple_of(2) {
        bail!("workloads must be supplied as name/path pairs");
    }
    let mut workloads = Vec::new();
    for pair in args.chunks_exact(2) {
        workloads.push(Workload {
            name: pair[0].clone(),
            elf: fs::read(&pair[1]).with_context(|| format!("read ELF {}", pair[1]))?,
        });
    }
    Ok(workloads)
}

fn run_guest<H: ResidentHost>(host: &mut H, elf: &[u8], argv: &[String]) -> Result<i32> {
    let mut entropy = vec![0_u8; 64 * 1024];
    getrandom::fill(&mut entropy).map_err(|error| anyhow!("host entropy: {error}"))?;
    host.supply_entropy(&entropy)?;
    let packed = if argv.is_empty() {
        None
    } else {
        let refs: Vec<&[u8]> = argv.iter().map(|value| value.as_bytes()).collect();
        Some(encode_argv(&refs)?)
    };
    let handle = host.create(elf, packed.as_deref())?;
    let result = (|| {
        let mut status = STATUS_READY;
        let mut calls = 0_u32;
        while status != STATUS_EXITED {
            status = host.run(handle, 10_000)?;
            calls += 1;
            if status != STATUS_READY && status != STATUS_EXITED {
                bail!("unexpected AgentVM status {status}");
            }
            if calls > 100_000 {
                bail!("AgentVM run-call bound exceeded");
            }
        }
        let stdout = host.stdout(handle)?;
        let stderr = host.stderr(handle)?;
        io::stdout().write_all(&stdout)?;
        io::stderr().write_all(&stderr)?;
        Ok(host.exit_code(handle)?)
    })();
    host.destroy(handle)?;
    if host.session_count()? != 0 {
        bail!("AgentVM session leak after run");
    }
    result
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() >= 4 && args[1] == "run" {
        let engine_name = &args[0];
        let wasm = fs::read(&args[2]).with_context(|| format!("read Wasm {}", args[2]))?;
        let elf = fs::read(&args[3]).with_context(|| format!("read ELF {}", args[3]))?;
        let guest_argv = if args.len() > 4 {
            args[4..].to_vec()
        } else {
            vec![args[3].clone()]
        };
        let exit = match engine_name.as_str() {
            "wasmtime" => run_guest(&mut wasmtime_host::instantiate(&wasm)?, &elf, &guest_argv)?,
            "wasmi" => run_guest(&mut wasmi_host::instantiate(&wasm)?, &elf, &guest_argv)?,
            other => bail!("unknown engine {other}"),
        };
        std::process::exit(exit.clamp(0, 255));
    }
    if args.len() < 6 || args[1] != "bench" {
        bail!("usage: agentvm-native-host <wasmtime|wasmi> run <wasm> <elf> [guest argv...] | agentvm-native-host <wasmtime|wasmi> bench <wasm> <iterations> <name> <elf> ...");
    }
    let engine_name = &args[0];
    let wasm = fs::read(&args[2]).with_context(|| format!("read Wasm {}", args[2]))?;
    let iterations: usize = args[3].parse().context("parse iterations")?;
    if iterations == 0 {
        bail!("iterations must be nonzero");
    }
    let workloads = parse_workloads(&args[4..])?;
    let result = match engine_name.as_str() {
        "wasmtime" => wasmtime_host::benchmark(&wasm, &workloads, iterations)?,
        "wasmi" => wasmi_host::benchmark(&wasm, &workloads, iterations)?,
        other => bail!("unknown engine {other}"),
    };
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
