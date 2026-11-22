---
name: verify-t3code
description: Prove a T3 Code change works by driving the real server and web client against an isolated scratch home, using the free Replay provider and the `t3` CLI. Use when a change touches orchestration, threads, runs, checkpoints, approvals, or chat UI and you need captured evidence. Complements test-t3-app (Browser panel recipe) and test-t3-mobile.
---

# Verify T3 Code

Launch an isolated dev server, drive a free `Replay (dev)` turn through the CLI and the web UI, and capture evidence. The Browser panel steps live in [test-t3-app](../test-t3-app/SKILL.md); this skill adds the isolation rules, a doctor, a database check, and a feature map.

Run everything from the repository root. Examples use Git Bash; the helpers are plain Node scripts and run anywhere.

## Isolation first

The machine usually already runs the developer's T3 Code, and it may use this checkout's own `.t3/` (read `.t3/userdata/server-runtime.json`). Never start a second server on `.t3/` or `~/.t3`, never kill a PID you did not start, and never write to either home.

Pick one scratch home and one evidence folder outside the repo and reuse them for the whole run:

```bash
T3V_ROOT="$(node -p "require('os').tmpdir()")/t3code-verify"
H="$T3V_ROOT/home"; E="$T3V_ROOT/evidence"; W="$T3V_ROOT/workspace"
mkdir -p "$H" "$E" "$W" && (cd "$W" && git init -q && echo "# fixture" > README.md)
```

`doctor.mjs` refuses `~/.t3` and the checkout's `.t3`.

## Launch

The dev runner shells out to `vp`, which is not on PATH in a plain shell. Put `node_modules/.bin` first, start the server as a background task of your own shell (so it ends with your session), and send its output to the evidence folder:

```bash
export PATH="$PWD/node_modules/.bin:$PATH"
node scripts/dev-runner.ts dev --home-dir "$H" --no-seed > "$E/dev.log" 2>&1
```

`--no-seed` starts from an empty database, so nothing from the developer's real data is copied. Use `vp run migrate-dev-db --base-dir "$H"` (stopped server only) when a flow needs realistic data.

Ready means the log holds a `Listening on http://127.0.0.1:<port>` line and a `pairingUrl:` line, and the doctor passes. The first start takes about 30 s, longer with a cold Vite cache or no Rust toolchain (the resource monitor build is skipped with a warning).

Ports come from the `[dev-runner]` line: `serverPort=` and `webPort=`. They shift when occupied, so never assume 13773 or 5733; those usually belong to another instance.

The pairing URL is a one-time admin credential. When you read the log, redact it: `sed -E 's/pairingUrl: .*/pairingUrl: <redacted>/' "$E/dev.log"`. To wait for readiness, filter the same way.

Add the fixture project once:

```bash
node apps/server/src/bin.ts project add --base-dir "$H" --title verify-fixture "$W"
```

## Doctor

Run this first, and again whenever something looks off. It is read-only:

```bash
node .agents/skills/verify-t3code/scripts/doctor.mjs "$H" "$E/dev.log"
```

It checks that the home is isolated, that the server PID in `server-runtime.json` is alive and answering, and that the web port answers. It exits 0 with `READY`, or 1 with the failing lines. A stale `server-runtime.json` means the server died.

## Drive

Two entry points reach the same pipeline. Prove with both when the change touches UI:

- **CLI** (fast, scriptable). `node apps/server/src/bin.ts thread start --base-dir "$H" --provider devReplay --model showcase --wait "$W" "go"` runs a turn and prints the reply. Follow with `thread list --base-dir "$H" --project "$W"` and `thread show --base-dir "$H" --messages 4 <thread-id>`. `--wait` exits 1 on failure and 2 when the run waits for an answer.
- **Web UI.** Follow test-t3-app's Browser panel steps: `preview_open` the `pairingUrl` from the log (one use; mint another with `node apps/server/src/bin.ts pair --base-dir "$H"`), then click the thread in the sidebar and use `preview_wait_for` on reply text. The sidebar shows the project `verify-fixture` and thread title `go` with a `Done` badge.

Replay scenario ids (model slugs of provider `devReplay`): `showcase`, `todo-list`, `approval`, `question`, `multi-turn`, `command-output`. Each prompt plays the next recorded turn. Use a real provider only when the change depends on that provider's behavior, and then its cheapest model.

The feature files in [features/](features/README.md) say which scenario and entry point proves each feature.

## Evidence

Write every artifact to `$E`, numbered in order, with the feature id in the name:

- the CLI command and its stdout (`tee "$E/NN-name.txt"`),
- a screenshot with the thread visible (`preview_snapshot` with `save=true`, then copy the PNG into `$E`),
- a read-only second view of stored state: `node .agents/skills/verify-t3code/scripts/db-summary.mjs "$H"` lists each run's status and its ready checkpoints.

Proof standards: exercise the real path (CLI or UI, not internal setters); capture the action and the resulting state; confirm the persisted rows as well as the screen; the Replay provider is the only mock, because it replaces the paid model, not T3 Code. Report any step you could not reach with the command and the unmet precondition. Do not weaken a journey to make it pass.

## Cleanup

Stop only what this run started. Stop the background task with your harness's stop, which ends the whole tree. If you must kill by PID on Windows, use the dev-runner PID you captured with `taskkill /PID <pid> /T /F`. Never match by name or path. Afterwards `doctor.mjs` should report no server for `$H`, and the developer's server (the PID in `.t3/userdata/server-runtime.json`) should be untouched.

Close the Browser tab you opened. Delete `$H` and `$W` when finished. Keep `$E`: proof artifacts outlive teardown.

## Gotchas

- Empty database: the server adds the directory it was started from (`server`) as a project with an unsent "New thread". It is harmless; sidebar assertions should target `verify-fixture`.
- The CLI project path argument and `--project` take a workspace path or project id; `thread list` prints `<thread-id>  <status>  <title>`.
- `spawn vp ENOENT` in the log means PATH was not extended (see Launch). Nothing is left running after that failure.
- Vite HMR makes the web port answer before the UI is usable. Wait for rendered text, not for the port.
