#!/usr/bin/env node
// Read-only: is the isolated dev server at <home-dir> worth driving?
// Usage: node .agents/skills/verify-t3code/scripts/doctor.mjs <home-dir> [dev.log]
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const [homeArg, logArg] = process.argv.slice(2);
if (!homeArg) {
  console.error("usage: doctor.mjs <home-dir> [dev.log]");
  process.exit(2);
}

const real = (p) => {
  try {
    return NodeFS.realpathSync(NodePath.resolve(p));
  } catch {
    return NodePath.resolve(p);
  }
};
const norm = (p) => real(p).toLowerCase();
const home = norm(homeArg);
const repo = norm(NodePath.join(import.meta.dirname, "..", "..", "..", ".."));
const protectedHomes = [
  norm(NodePath.join(NodeOS.homedir(), ".t3")),
  norm(NodePath.join(repo, ".t3")),
];
const problems = [];
const ok = (msg) => console.log(`ok    ${msg}`);
const bad = (msg) => {
  problems.push(msg);
  console.log(`FAIL  ${msg}`);
};

if (protectedHomes.some((p) => home === p || home.startsWith(p + NodePath.sep))) {
  bad(
    `home ${homeArg} is a live T3 Code home (~/.t3 or the checkout's .t3). Use a separate scratch dir.`,
  );
} else {
  ok(`home ${real(homeArg)} is isolated from ~/.t3 and ${NodePath.join(repo, ".t3")}`);
}

const runtimeFile = NodePath.join(homeArg, "userdata", "server-runtime.json");
let runtime;
if (!NodeFS.existsSync(runtimeFile)) {
  bad(`no ${runtimeFile}: the server has not started (or already stopped)`);
} else {
  runtime = JSON.parse(NodeFS.readFileSync(runtimeFile, "utf8"));
  try {
    process.kill(runtime.pid, 0);
    ok(`server pid ${runtime.pid} is alive`);
  } catch {
    bad(`server pid ${runtime.pid} is not running; server-runtime.json is stale`);
  }
  try {
    const res = await fetch(runtime.origin, { signal: AbortSignal.timeout(5000) });
    ok(`${runtime.origin} answers HTTP ${res.status}`);
  } catch (error) {
    bad(`${runtime.origin} unreachable: ${error.message}`);
  }
  const head = NodeChildProcess.execFileSync("git", ["-C", repo, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  }).trim();
  ok(`server ${runtime.serverVersion} started ${runtime.startedAt}; checkout HEAD is ${head}`);
}

if (logArg && NodeFS.existsSync(logArg)) {
  const log = NodeFS.readFileSync(logArg, "utf8");
  const web = /webPort=(\d+)/.exec(log)?.[1];
  const hasPairing = /pairingUrl:/.test(log);
  if (web) {
    try {
      const res = await fetch(`http://localhost:${web}/`, { signal: AbortSignal.timeout(5000) });
      ok(`web http://localhost:${web}/ answers HTTP ${res.status}`);
    } catch (error) {
      bad(`web port ${web} unreachable: ${error.message}`);
    }
  } else {
    bad("no webPort in dev log: the dev runner has not reported its ports");
  }
  console.log(
    `info  startup pairing URL ${hasPairing ? "is in the log (single use; do not paste it anywhere)" : "not printed yet"}`,
  );
}

console.log(problems.length ? `\nNOT READY (${problems.length})` : "\nREADY");
process.exit(problems.length ? 1 : 0);
