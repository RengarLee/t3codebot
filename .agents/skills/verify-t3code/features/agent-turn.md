# Agent turn on the Replay provider

A user sends a message to an agent and sees the reply stream into the thread, ending in a completed run with checkpoints. The Replay provider plays a recorded turn through the real adapter, orchestration, and UI at no cost.

## Sub-features

- `turn-start` creates a thread and starts a run from the CLI.
- `turn-render` shows the reply, plan, tool calls, and table in the web client.
- `turn-persist` stores the run as `completed` with ready checkpoints.

## How to get to it (user POV)

- Type a message in the composer and press send (web).
- Run `t3 thread start` with a project and a message (CLI).
- Use the composer model picker to choose `Replay (dev)` / `Showcase`, or press `Ctrl+Alt+Shift+R`.

## Driving it with the t3 CLI and the Browser panel

Preconditions: baseline from [README.md](README.md); no thread titled `go`.

- **Start.** `node apps/server/src/bin.ts thread start --base-dir "$H" --provider devReplay --model showcase --wait "$W" "go" | tee "$E/02-thread-start.txt"`. Exit code 0; stdout ends with `This turn is a replay. It costs nothing, so send it again as often as you need.`
- **List.** `thread list --base-dir "$H" --project "$W"` prints `<thread-id>  completed  go`.
- **Show.** `thread show --base-dir "$H" --messages 4 <thread-id>` prints header `<thread-id>  completed  devReplay/showcase`, the `[user]` message `go`, and two `[assistant]` messages.
- **UI.** `preview_open` the pairing URL, click the sidebar entry `go` under `verify-fixture`, then `preview_wait_for` text `This turn is a replay`. Save a screenshot to `$E/05-ui-thread.png`.
- **Persistence.** `node .agents/skills/verify-t3code/scripts/db-summary.mjs "$H"` shows one row: provider `devReplay`, status `completed`, `ready_checkpoints` 2.

## Gotchas

- Run it on an empty database and the dev server's own `server` project and "New thread" also appear in the sidebar; ignore them.
- A thread started from the CLI has an id prefixed `mcp:`; that is expected.
- The reply text is recorded content. Assert completion and rendered text, not model wording that a real provider would produce.
