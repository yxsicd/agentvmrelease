import { mkdir, writeFile } from "node:fs/promises";

const needs = JSON.parse(process.env.AGENTVM_CI_NEEDS || "{}");
const entries = Object.entries(needs).map(([job, value]) => ({
  job,
  result: value?.result ?? "missing",
}));
const failures = entries.filter(({ result }) => result !== "success");
await mkdir("target/ci-aggregate", { recursive: true });
const report = {
  schema: "agentvm.public-verification/v1",
  repository: process.env.GITHUB_REPOSITORY || null,
  run_id: process.env.GITHUB_RUN_ID || null,
  commit: process.env.GITHUB_SHA || null,
  channel: process.env.AGENTVM_CHANNEL || "dev",
  jobs: entries,
  ok: failures.length === 0,
};
await writeFile(
  "target/ci-aggregate/verification-report.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
if (failures.length !== 0) process.exit(1);
